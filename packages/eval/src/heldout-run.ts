/**
 * Runs the held-out suite against built packs. Each locale gets the engine a client has for it
 * (en + that locale, core + ext; see core/src/loader.ts), alone and fused with the production
 * model's vectors. Writes reports/heldout.md and reports/heldout.json; the gate only warns.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { disposeEmbeddings, embedTexts } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import {
  type AliasEngine,
  type AliasSearchOutput,
  createEngine,
  decodeVectors,
  fuse,
  l2normalize,
  type Pack,
  type SearchResult,
  searchVectors,
} from "emojisense";
import {
  type HeldoutBaseline,
  type HeldoutQuery,
  heldoutRegressions,
  type LocaleScores,
  loadHeldout,
  localesOf,
  scoreByLocale,
  toBaseline,
} from "./heldout.ts";
import { type InHouseScores, renderHeldoutReport } from "./heldout-report.ts";
import { judge, type QueryOutcome } from "./metrics.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
export const HELDOUT_PATH = join(EVAL_ROOT, "queries", "heldout.jsonl");
const BASELINE_PATH = join(EVAL_ROOT, "reports", "heldout-baseline.json");
const LIMIT = 10;
export const ALIAS_MODE = "alias (core + ext)";

export interface HeldoutMode {
  name: string;
  kind: "alias" | "fused";
  scores: LocaleScores;
  outcomes: QueryOutcome[];
}

export interface HeldoutRun {
  queries: HeldoutQuery[];
  locales: string[];
  modes: HeldoutMode[];
  /** Modes that could not run, with the reason (e.g. query vectors not cached with --offline). */
  skipped: string[];
}

export async function runHeldoutSuite(options: {
  packDir: string;
  queries: HeldoutQuery[];
  model: { key: string; dims: number };
  offline: boolean;
}): Promise<HeldoutRun> {
  const { packDir, queries, offline } = options;
  const readPack = (name: string): Pack =>
    JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
  const locales = localesOf(queries);
  const en = [readPack("en"), readPack("en.ext")];
  const engines = new Map<string, AliasEngine>(
    locales.map((l) => [l, createEngine(l === "en" ? en : [...en, readPack(l), readPack(`${l}.ext`)])]),
  );
  const engineFor = (q: HeldoutQuery) => engines.get(q.locale) as AliasEngine;
  const alias = new Map<string, AliasSearchOutput>(
    queries.map((q) => [q.id, engineFor(q).search(q.q, { locale: q.locale, limit: 24 })]),
  );
  const evaluate = (name: string, kind: HeldoutMode["kind"], rank: (q: HeldoutQuery) => string[]) => {
    const outcomes = queries.map((q) => judge(q, rank(q)));
    return { name, kind, outcomes, scores: scoreByLocale(queries, outcomes) };
  };

  const modes: HeldoutMode[] = [
    evaluate(ALIAS_MODE, "alias", (q) =>
      (alias.get(q.id) as AliasSearchOutput).results.slice(0, LIMIT).map((r) => r.emoji),
    ),
  ];
  const skipped: string[] = [];
  const model = getModel(options.model.key);
  const tag = `${model.key}@${options.model.dims}`;
  const vectorPath = join(packDir, `vectors.${model.key}.${options.model.dims}.bin`);
  if (!existsSync(vectorPath)) {
    skipped.push(`fused ${tag}: no ${vectorPath.split("/").at(-1)} in the pack directory`);
    return { queries, locales, modes, skipped };
  }
  try {
    const texts = queries.map((q) => formatQuery(model, q.q));
    const { vectors } = await embedTexts(model, texts, "query", { offline });
    const index = decodeVectors(readFileSync(vectorPath));
    const semantic = new Map<string, SearchResult[]>(
      queries.map((q, i) => {
        const query = l2normalize((vectors[i] as Float32Array).slice(0, options.model.dims));
        const results = searchVectors(index, query, 24).map((m) => ({
          emoji: engineFor(q).get(m.id)?.emoji ?? "",
          id: m.id,
          score: m.score,
          source: "semantic" as const,
        }));
        return [q.id, results];
      }),
    );
    modes.push(
      evaluate(`fused ${tag}`, "fused", (q) =>
        fuse(alias.get(q.id) as AliasSearchOutput, semantic.get(q.id) as SearchResult[], LIMIT).map(
          (r) => r.emoji,
        ),
      ),
    );
  } catch (error) {
    skipped.push(`fused ${tag}: ${(error as Error).message}`);
  } finally {
    await disposeEmbeddings();
  }
  return { queries, locales, modes, skipped };
}

/** Write a GitHub Actions annotation in CI, a plain line elsewhere. */
function warn(message: string) {
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning title=Held-out eval::${message}`);
  else console.warn(`⚠ ${message}`);
}

/**
 * Run the suite, compare with reports/heldout-baseline.json, write the reports. The gate is
 * soft: a drop is printed as a warning and never fails the process (DECISIONS.md).
 */
export async function runAndReportHeldout(options: {
  packDir: string;
  packVersion: string;
  model: { key: string; dims: number };
  offline: boolean;
  writeBaseline: boolean;
  inHouse?: InHouseScores;
}): Promise<HeldoutRun> {
  const queries = loadHeldout(HELDOUT_PATH);
  const run = await runHeldoutSuite({ ...options, queries });
  const current = toBaseline(run.modes);
  const baseline: HeldoutBaseline | undefined = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : undefined;
  const warnings = baseline ? heldoutRegressions(current, baseline) : [];
  for (const message of warnings) warn(message);
  for (const message of run.skipped) console.warn(`held-out: skipped ${message}`);

  const report = renderHeldoutReport(run, {
    date: new Date().toISOString().slice(0, 10),
    packVersion: options.packVersion,
    inHouse: options.inHouse,
    gate: { baseline: baseline !== undefined, warnings, written: options.writeBaseline },
  });
  writeFileSync(join(EVAL_ROOT, "reports", "heldout.md"), `${report}\n`);
  const json = {
    date: new Date().toISOString(),
    packVersion: options.packVersion,
    queries: run.queries.length,
    locales: run.locales,
    modes: run.modes.map(({ name, kind, scores, outcomes }) => ({ name, kind, ...scores, outcomes })),
    skipped: run.skipped,
    gate: { warnings },
  };
  writeFileSync(join(EVAL_ROOT, "reports", "heldout.json"), `${JSON.stringify(json, null, 1)}\n`);
  if (options.writeBaseline) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`held-out baseline written: ${BASELINE_PATH}`);
  }
  return run;
}
