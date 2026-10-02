/**
 * Ranks a dev set (queries/*-dev.jsonl) in every mode a client can show. Each locale gets the
 * engine a client has for it (en + that locale, core + ext); the semantic list searches the
 * shared vector file plus the locale's own, as the Worker does (PACK_FORMAT §5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { disposeEmbeddings, embedTexts } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import {
  type AliasEngine,
  type AliasSearchOutput,
  embeddingText,
  type Pack,
  type SearchResult,
  shouldUseSemantic,
} from "emojisense";
import { l2normalize } from "emojisense/vectors";
import type { EvalQuery } from "./queries.ts";
import { fuseRanked, rankingEngine, semanticSearch } from "./ranking.ts";
import { loadVectorLayout } from "./vector-layout.ts";

export type DevMode = "alias" | "semantic" | "fused" | "gated";
export const DEV_MODES: DevMode[] = ["alias", "semantic", "fused", "gated"];
const LIMIT = 10;

export interface DevRow {
  q: EvalQuery;
  lists: Record<DevMode, string[]>;
  /** The alias output and the semantic list (24 each) the lists were built from, and the fused list. */
  alias: AliasSearchOutput;
  semantic: SearchResult[];
  fused: SearchResult[];
}

export interface DevRun {
  packVersion: string;
  /** e.g. "bge-m3@1024 (shared + 10 locales)" */
  vectors: string;
  rows: DevRow[];
}

export async function rankDevSet(
  queries: EvalQuery[],
  options: { pack?: string | undefined; offline: boolean },
): Promise<DevRun> {
  const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
    readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
  );
  const packDir = options.pack ?? join(DATA_ROOT, "dist", "packs", packConfig.packVersion);
  const readPack = (name: string): Pack =>
    JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
  const en = [readPack("en"), readPack("en.ext")];
  const engines = new Map<string, AliasEngine>();
  const engineFor = (locale: string): AliasEngine => {
    let engine = engines.get(locale);
    if (!engine) {
      engine = rankingEngine(locale === "en" ? en : [...en, readPack(locale), readPack(`${locale}.ext`)]);
      engines.set(locale, engine);
    }
    return engine;
  };

  const { key, dims } = packConfig.model;
  const model = getModel(key);
  const layout = loadVectorLayout(packDir, model, dims);
  if (!layout) throw new Error(`no vectors.${key}.${dims}*.bin in ${packDir}: run the embed step`);
  let vectors: Float32Array[];
  try {
    ({ vectors } = await embedTexts(
      model,
      queries.map((q) => formatQuery(model, embeddingText(q.q))),
      "query",
      { offline: options.offline },
    ));
  } finally {
    await disposeEmbeddings();
  }

  const rows = queries.map((q, i): DevRow => {
    const engine = engineFor(q.locale);
    const alias = engine.search(q.q, { locale: q.locale, limit: 24 });
    const query = l2normalize((vectors[i] as Float32Array).slice(0, dims));
    const semantic = semanticSearch(engine, layout, q.locale, query, 24);
    const fused = fuseRanked(engine, alias, semantic, LIMIT);
    return {
      q,
      alias,
      semantic,
      fused,
      lists: {
        alias: alias.results.slice(0, LIMIT).map((r) => r.emoji),
        semantic: semantic.slice(0, LIMIT).map((r) => r.emoji),
        fused: fused.map((r) => r.emoji),
        gated: (shouldUseSemantic(alias) ? fused : alias.results.slice(0, LIMIT)).map((r) => r.emoji),
      },
    };
  });
  return { packVersion: packConfig.packVersion, vectors: layout.label, rows };
}
