import type { EmbeddingModel } from "@emojisense/data/models";
import {
  type AliasEngine,
  type AliasSearchOutput,
  fuse,
  l2normalize,
  type SearchResult,
  searchVectors,
  type VectorIndex,
} from "emojisense";
import type { Env, GeneratedConfig } from "./env.ts";

/** The data one Worker build serves: alias engine, emoji vectors and the model that made them. */
export interface Catalog {
  config: GeneratedConfig;
  model: EmbeddingModel;
  engine(): AliasEngine;
  index(): VectorIndex;
}

export function modelTag(catalog: Catalog): string {
  return `${catalog.config.modelKey}@${catalog.config.dims}`;
}

export function indexTag(catalog: Catalog): string {
  return `${catalog.config.packVersion}:${modelTag(catalog)}`;
}

async function embed(env: Env, catalog: Catalog, text: string): Promise<Float32Array> {
  if (!env.AI) throw new Error("AI binding missing");
  const { config, model } = catalog;
  const input = config.queryTemplate.replace("{q}", text);
  const output = (await env.AI.run(config.modelId, model.input([input], "query"))) as {
    data?: number[][];
    response?: number[][];
  };
  const vector = (output.data ?? output.response)?.[0];
  if (!vector || vector.length < config.dims) throw new Error("unexpected embedding response");
  // Matryoshka truncation, then re-normalize: the treatment the emoji vectors got (PACK_FORMAT §5).
  return l2normalize(Float32Array.from(vector.slice(0, config.dims)));
}

export interface Embedded {
  /** L2-normalized at the catalog dims; undefined when Workers AI failed. */
  vector?: Float32Array | undefined;
  degraded: boolean;
  ms: number;
}

/**
 * Embed a query, never throwing: a Workers AI failure is logged (the error name only when the
 * text is user content) and reported as degraded.
 */
export async function embedQuery(
  env: Env,
  catalog: Catalog,
  text: string,
  privateText = false,
): Promise<Embedded> {
  const started = Date.now();
  try {
    const vector = await embed(env, catalog, text);
    return { vector, degraded: false, ms: Date.now() - started };
  } catch (error) {
    const { name, message } = error as Error;
    console.warn(
      JSON.stringify({ event: "semantic_unavailable", error: name, ...(privateText ? {} : { message }) }),
    );
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
  /** The text is user content (reactions, captions): never put error details in the logs. */
  privateText?: boolean;
}

export interface Ranked {
  results: SearchResult[];
  /** Semantic ranking was asked for but Workers AI was unavailable. */
  degraded: boolean;
  /** True when a semantic ranking was produced (the call is billable). */
  semantic: boolean;
  embedMs: number;
  aliasConfidence?: number | undefined;
  semanticTop?: number | undefined;
}

/** Alias and/or semantic ranking, fused when both ran. Workers AI failures degrade, never throw. */
export async function rank(env: Env, catalog: Catalog, options: RankOptions): Promise<Ranked> {
  const { aliasQuery, embedText, locale, limit } = options;
  const engine = catalog.engine();
  const alias: AliasSearchOutput | undefined =
    aliasQuery === undefined
      ? undefined
      : engine.search(aliasQuery, { locale, limit, prefix: options.prefix ?? true });

  let semantic: SearchResult[] | undefined;
  let degraded = false;
  let embedMs = 0;
  if (embedText !== undefined) {
    const embedded = await embedQuery(env, catalog, embedText, options.privateText);
    ({ degraded, ms: embedMs } = embedded);
    if (embedded.vector) {
      semantic = searchVectors(catalog.index(), embedded.vector, limit).map((m) => ({
        emoji: engine.get(m.id)?.emoji ?? "",
        id: m.id,
        score: Math.round(m.score * 1000) / 1000,
        source: "semantic" as const,
      }));
    }
  }

  let results: SearchResult[];
  if (alias && semantic) results = fuse(alias, semantic, limit);
  else results = alias?.results ?? semantic ?? [];
  return {
    results: results.map(({ emoji, id, score, source }) => ({ emoji, id, score, source })),
    degraded,
    semantic: semantic !== undefined,
    embedMs,
    aliasConfidence: alias?.confidence,
    semanticTop: semantic?.[0]?.score,
  };
}
