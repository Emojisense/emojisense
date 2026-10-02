/**
 * The API's concept tier, run offline for evals: the unsure verdict (`assessConfidence`), then for
 * each unsure query the Worker's own prompt, checks and ranking (packages/worker/src/concepts)
 * with the production model through Workers AI. Model answers are cached on disk
 * (.cache/concepts/<tag>.json, keyed by a hash of locale and normalized query), so a rerun makes
 * no model call. The ranking uses the Worker's bundled engine (en + tr, core + ext) and the shared
 * vectors, as the Worker does.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { disposeEmbeddings, embedTexts, runWorkersAI } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import { CACHE_DIR } from "@emojisense/data/paths";
import { semanticBonus } from "@emojisense/data/semantic-score";
import {
  type AliasEngine,
  type AliasSearchOutput,
  assessConfidence,
  embeddingText,
  type Pack,
  type QueryConfidence,
  type SearchResult,
  type SemanticCalibration,
} from "emojisense";
import { l2normalize, searchVectorSets } from "emojisense/vectors";
import { CONCEPT_MODEL, CONCEPT_TAG } from "../../worker/src/concepts/config.ts";
import { type ConceptAnswer, conceptInput, parseConcept } from "../../worker/src/concepts/model.ts";
import { neighbourText, rankConcept } from "../../worker/src/concepts/rank.ts";
import { rankingEngine } from "./ranking.ts";
import { loadVectorLayout } from "./vector-layout.ts";

/** Workers AI: USD per 1,000 neurons (developers.cloudflare.com/workers-ai/platform/pricing, 2026-10-02). */
export const USD_PER_1K_NEURONS = 0.011;

export interface ConceptItem {
  /** The normalized query, as the Worker passes it to the tier. */
  query: string;
  locale: string;
  alias: AliasSearchOutput;
  semantic: readonly SearchResult[];
}

export interface ConceptVerdict extends QueryConfidence {
  /** Unsure queries only. `missing`: offline without a cached answer, or the call failed. */
  concept?: {
    status: "ok" | "none" | "missing";
    answer?: ConceptAnswer;
    results: SearchResult[];
    display: string[];
  };
}

interface CachedCall {
  /** The model's message content, as returned. */
  content: string;
  ms: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number };
}

export interface ConceptTierStats {
  /** Every cached call of this prompt version (this run's and earlier ones). */
  calls: CachedCall[];
  /** Calls made by this run (not from the disk cache). */
  freshCalls: number;
  failures: string[];
  embedMs: number[];
}

const cachePath = join(CACHE_DIR, "concepts", `${CONCEPT_TAG.replace(/[^\w.-]+/g, "_")}.json`);
const keyOf = (q: string, locale: string) =>
  createHash("sha256").update(`${locale}\n${q}`).digest("hex").slice(0, 32);

async function pool<T>(items: readonly T[], lanes: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, lanes) }, async () => {
      while (next < items.length) await work(items[next++] as T);
    }),
  );
}

export async function runConceptTier(
  items: readonly ConceptItem[],
  options: {
    packDir: string;
    model: { key: string; dims: number };
    offline: boolean;
    concurrency?: number;
    /** The semantic list's calibration for the unsure verdict; default: the production model's. */
    calibration?: SemanticCalibration;
  },
): Promise<{ verdicts: ConceptVerdict[]; stats: ConceptTierStats }> {
  const readPack = (name: string): Pack =>
    JSON.parse(readFileSync(join(options.packDir, `pack.${name}.json`), "utf8"));
  const engine: AliasEngine = rankingEngine([
    readPack("en"),
    readPack("tr"),
    readPack("en.ext"),
    readPack("tr.ext"),
  ]);
  const model = getModel(options.model.key);
  const { dims } = options.model;
  const layout = loadVectorLayout(options.packDir, model, dims);
  if (!layout) throw new Error(`no vectors in ${options.packDir}`);

  const cache: Record<string, CachedCall> = existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, "utf8"))
    : {};
  const stats: ConceptTierStats = { calls: [], freshCalls: 0, failures: [], embedMs: [] };
  const verdicts: ConceptVerdict[] = items.map((item) =>
    assessConfidence(item.alias, item.semantic, options.calibration),
  );
  const unsure = items.map((_, i) => i).filter((i) => verdicts[i]?.unsure);

  const contents = new Map<number, string>();
  await pool(unsure, options.concurrency ?? 4, async (i) => {
    const { query, locale } = items[i] as ConceptItem;
    const key = keyOf(query, locale);
    let call = cache[key];
    if (!call && !options.offline) {
      const started = performance.now();
      try {
        const output = (await runWorkersAI(CONCEPT_MODEL, conceptInput(query, locale))) as {
          choices?: { message?: { content?: string } }[];
          usage?: CachedCall["usage"];
        };
        call = {
          content: output.choices?.[0]?.message?.content ?? "",
          ms: performance.now() - started,
          ...(output.usage ? { usage: output.usage } : {}),
        };
        cache[key] = call;
        stats.freshCalls++;
      } catch (error) {
        stats.failures.push((error as Error).name);
      }
    }
    if (call) contents.set(i, call.content);
  });
  mkdirSync(join(CACHE_DIR, "concepts"), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
  stats.calls = Object.values(cache);

  const answers = new Map<number, ConceptAnswer | undefined>();
  for (const [i, content] of contents) {
    try {
      answers.set(
        i,
        parseConcept({ choices: [{ message: { content } }] }, engine, (items[i] as ConceptItem).locale),
      );
    } catch {
      answers.set(i, undefined);
    }
  }

  // Semantic neighbours of each answer's terms, over the shared vectors.
  const withTerms = [...answers.entries()].filter(
    (entry): entry is [number, ConceptAnswer] => entry[1] !== undefined && neighbourText(entry[1]) !== "",
  );
  const neighbours = new Map<number, SearchResult[]>();
  try {
    const { vectors, stats: embedStats } = await embedTexts(
      model,
      withTerms.map(([, answer]) => formatQuery(model, embeddingText(neighbourText(answer), 128))),
      "query",
      { offline: options.offline },
    );
    stats.embedMs = embedStats.callMs;
    withTerms.forEach(([i], j) => {
      // The Worker's semanticResults over the shared vectors: cosine plus the popularity prior,
      // no glyph term.
      const query = l2normalize((vectors[j] as Float32Array).slice(0, dims));
      const bonus = semanticBonus(engine.popularity, undefined, query);
      neighbours.set(
        i,
        searchVectorSets(layout.indexesFor("en"), query, 8, { bonus }).map((m) => ({
          emoji: engine.get(m.id)?.emoji ?? "",
          id: m.id,
          score: Math.round(m.score * 1000) / 1000,
          source: "semantic" as const,
        })),
      );
    });
  } catch (error) {
    console.warn(`concept neighbours not embedded: ${(error as Error).message}`);
  } finally {
    await disposeEmbeddings();
  }

  for (const i of unsure) {
    const verdict = verdicts[i] as ConceptVerdict;
    if (!answers.has(i)) {
      verdict.concept = { status: "missing", results: [], display: [] };
      continue;
    }
    const answer = answers.get(i);
    const ranked = answer ? rankConcept(engine, answer, neighbours.get(i)) : undefined;
    verdict.concept = {
      status: answer ? "ok" : "none",
      ...(answer ? { answer } : {}),
      results: ranked?.results ?? [],
      display: ranked?.display ?? [],
    };
  }
  return { verdicts, stats };
}
