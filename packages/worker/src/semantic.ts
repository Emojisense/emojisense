import type { EmbeddingModel } from "@emojisense/data/models";
import { semanticBonus } from "@emojisense/data/semantic-score";
import { type AliasEngine, type AliasSearchOutput, type Culture, fuse, type SearchResult } from "emojisense";
import { l2normalize, searchVectorSets, type VectorIndex } from "emojisense/vectors";
import type { Env, GeneratedConfig } from "./env.ts";
import type { LocaleIndexes } from "./locale-vectors.ts";

/** The data one Worker build serves: alias engines, emoji vectors and the model that made them. */
export interface Catalog {
  config: GeneratedConfig;
  model: EmbeddingModel;
  /** The bundled alias engine (en). It also turns semantic hits into emoji. */
  engine(): AliasEngine;
  /**
   * The alias engine for a pack locale: the bundled one, or one built from the locale's pack on
   * first use (locale-engines.ts). Undefined when that pack cannot be loaded now.
   */
  aliasEngine(locale: string, env: Env): Promise<AliasEngine | undefined>;
  /** The shared (English) emoji vectors, bundled. Reactions search these. */
  index(): VectorIndex;
  /** The glyph vectors (`vectors.<model>.<dims>.glyph.bin`), bundled; undefined when the build has none. */
  glyph?(): VectorIndex | undefined;
  /** What a query of `locale` searches: the shared index and the locale's own (locale-vectors.ts). */
  vectors(locale: string, env: Env): Promise<LocaleIndexes>;
  /**
   * The published culture file of a pack locale (culture.ts), for `/v1/search?culture=1`.
   * Undefined (or a missing member) = no culture layer: the answer is the canonical ranking.
   */
  culture?(locale: string, env: Env): Promise<Culture | undefined>;
}

export function modelTag(catalog: Catalog): string {
  return `${catalog.config.modelKey}@${catalog.config.dims}`;
}

export function indexTag(catalog: Catalog): string {
  return `${catalog.config.packVersion}:${modelTag(catalog)}`;
}

/**
 * One Workers AI call for up to `model.maxBatch` texts (already `embeddingText`), in order. The
 * search route sends one text, the nightly shard build (shards/job.ts) a batch: both embed the
 * same way. Throws on a failed call or a malformed answer.
 */
export async function embedTexts(
  env: Env,
  catalog: Catalog,
  texts: readonly string[],
): Promise<Float32Array[]> {
  if (!env.AI) throw new Error("AI binding missing");
  const { config, model } = catalog;
  // A replacer function, so "$&" or "$1" in a query is not read as a replacement pattern.
  const inputs = texts.map((text) => config.queryTemplate.replace("{q}", () => text));
  const output = (await env.AI.run(config.modelId, model.input(inputs, "query"))) as {
    data?: number[][];
    response?: number[][];
  };
  const vectors = output.data ?? output.response;
  if (!vectors || vectors.length !== texts.length) throw new Error("unexpected embedding response");
  return vectors.map((vector) => {
    if (vector.length < config.dims) throw new Error("unexpected embedding response");
    // Matryoshka truncation, then re-normalize: the treatment the emoji vectors got (PACK_FORMAT §5).
    return l2normalize(Float32Array.from(vector.slice(0, config.dims)));
  });
}

async function embed(env: Env, catalog: Catalog, text: string): Promise<Float32Array> {
  const [vector] = await embedTexts(env, catalog, [text]);
  return vector as Float32Array;
}

/**
 * The semantic list of the API: each emoji's best row over `indexes`, plus the popularity prior
 * and the glyph term (PACK_FORMAT.md §5, "Semantic score"), scores to three decimals. `engine`
 * holds the English core pack (its `popularity`) and turns ids into emoji.
 */
export function semanticResults(
  engine: AliasEngine,
  indexes: readonly VectorIndex[],
  vector: Float32Array,
  limit: number,
  glyph?: VectorIndex,
): SearchResult[] {
  const bonus = semanticBonus(engine.popularity, glyph, vector);
  return searchVectorSets(indexes, vector, limit, { bonus }).map((m) => ({
    emoji: engine.get(m.id)?.emoji ?? "",
    id: m.id,
    score: Math.round(m.score * 1000) / 1000,
    source: "semantic" as const,
  }));
}

export interface Embedded {
  /** L2-normalized at the catalog dims; undefined when Workers AI failed. */
  vector?: Float32Array | undefined;
  degraded: boolean;
  ms: number;
}

/**
 * Embed a query, never throwing: a Workers AI failure is logged and reported as degraded. The
 * log holds the error type only, because a message could quote the input, and logs never hold
 * user text (search queries included).
 */
export async function embedQuery(env: Env, catalog: Catalog, text: string): Promise<Embedded> {
  const started = Date.now();
  try {
    const vector = await embed(env, catalog, text);
    return { vector, degraded: false, ms: Date.now() - started };
  } catch (error) {
    console.warn(JSON.stringify({ event: "semantic_unavailable", error: (error as Error).name }));
    return { degraded: true, ms: Date.now() - started };
  }
}

export interface RankOptions {
  /** Searched in the alias dictionary. Omit for semantic-only ranking. */
  aliasQuery?: string | undefined;
  /** Embedded for semantic search. Omit for alias-only ranking (e.g. over the plan limit). */
  embedText?: string | undefined;
  locale: string;
  limit: number;
  /** Treat the last alias token as a prefix (typing). False for whole messages and captions. */
  prefix?: boolean;
}

export interface Ranked {
  results: SearchResult[];
  /** Semantic ranking was asked for but Workers AI was unavailable. */
  degraded: boolean;
  /** True when a semantic ranking was produced (the call is billable). */
  semantic: boolean;
  /** The Workers AI call alone. */
  embedMs: number;
  /** Waiting for the locale's vector file (0 once it is resident in the isolate). */
  vectorsMs: number;
  /** Waiting for the locale's alias engine (0 once it is resident in the isolate). */
  localeMs: number;
  aliasConfidence?: number | undefined;
  semanticTop?: number | undefined;
  /** The locale whose aliases ranked the results; null when no alias search ran. */
  aliasLocale: string | null;
  /** Aliases were asked for, but the locale's pack could not be loaded: never cache the answer. */
  aliasUnavailable: boolean;
  /** The locale's vector file could not be loaded; semantic results used the shared file only. */
  vectorsUnavailable: boolean;
  /** The alias output, when the alias search ran. */
  alias?: AliasSearchOutput | undefined;
  /** The semantic list before fusion, when it ran. */
  semanticList?: SearchResult[] | undefined;
}

/**
 * Alias and/or semantic ranking, fused when both ran. Workers AI failures degrade, never throw.
 * When the locale's pack cannot be loaded, ranking is semantic-only (bge-m3 is multilingual).
 * Semantic search covers the shared vectors and the locale's own; each emoji scores its best row.
 */
export async function rank(env: Env, catalog: Catalog, options: RankOptions): Promise<Ranked> {
  const { aliasQuery, embedText, locale, limit } = options;
  const started = Date.now();
  // The Workers AI call goes out first. In a new isolate the engines below take a CPU moment to
  // build (the bundled English engine: ≈ 70 ms on a laptop), which then overlaps the call.
  const embedding = embedText !== undefined ? embedQuery(env, catalog, embedText) : undefined;
  const engine = catalog.engine();
  // How long a load kept this call waiting; its failure is handled where its value is used.
  const elapsed = () => Date.now() - started;
  const waited = (promise: Promise<unknown>) => promise.then(elapsed, elapsed);
  // A locale's alias engine is built (first use per isolate only) while the query is embedded.
  const aliasLoad = aliasQuery !== undefined ? catalog.aliasEngine(locale, env) : undefined;
  const localeWait = aliasLoad ? waited(aliasLoad) : Promise.resolve(0);

  let semantic: SearchResult[] | undefined;
  let degraded = false;
  let embedMs = 0;
  let vectorsMs = 0;
  let vectorsUnavailable = false;
  if (embedding) {
    // A locale's vector file loads while the query is embedded (first use per isolate only).
    const vectorsLoad = catalog.vectors(locale, env);
    const [embedded, vectors, vectorsWait] = await Promise.all([embedding, vectorsLoad, waited(vectorsLoad)]);
    ({ degraded, ms: embedMs } = embedded);
    vectorsMs = vectorsWait;
    if (embedded.vector) {
      vectorsUnavailable = !vectors.complete;
      semantic = semanticResults(engine, vectors.indexes, embedded.vector, limit, catalog.glyph?.());
    }
  }

  let alias: AliasSearchOutput | undefined;
  if (aliasQuery !== undefined) {
    const aliasEngine = await aliasLoad;
    alias = aliasEngine?.search(aliasQuery, { locale, limit, prefix: options.prefix ?? true });
  }
  let results: SearchResult[];
  if (alias && semantic) results = fuse(alias, semantic, limit, undefined, { popularity: engine.popularity });
  else results = alias?.results ?? semantic ?? [];
  return {
    results: results.map(({ emoji, id, score, source }) => ({ emoji, id, score, source })),
    degraded,
    semantic: semantic !== undefined,
    embedMs,
    vectorsMs,
    localeMs: await localeWait,
    aliasConfidence: alias?.confidence,
    semanticTop: semantic?.[0]?.score,
    aliasLocale: alias ? locale : null,
    aliasUnavailable: aliasQuery !== undefined && !alias,
    vectorsUnavailable,
    alias,
    semanticList: semantic,
  };
}
