import type { SemanticRow } from "emojisense";

export type { Shard, ShardIndex } from "emojisense";

/** Shards written now: version 2 holds model output (core shards.ts reads both versions). */
export const SHARD_FORMAT_VERSION = 2;

/**
 * One candidate of the model output, as a version 2 shard stores it (PACK_FORMAT.md §6): no
 * ranking policy is applied, so a policy change needs no rebuild (core semantic-policy.ts).
 */
export type ShardRow = SemanticRow;

/** True for the rows of a version 2 shard; version 1 rows (a policy already applied) are not reused. */
export const isShardRows = (rows: readonly unknown[]): rows is ShardRow[] =>
  rows.length > 0 && rows.every((row) => Array.isArray(row) && row.length === 4);

/** A normalized query with how often it was seen and in which UI locales. */
export interface QueryCount {
  q: string;
  n: number;
  locales: string[];
}

/**
 * Produces the model output of the API's `mode=semantic` path for a query (core `semanticRows`).
 * Workers AI in production, cached embeddings offline, a fake in tests and dry runs.
 */
export interface ShardResolver {
  /** Model tag written to index.json, e.g. "embeddinggemma@256". Shards are valid only for it. */
  readonly model: string;
  /** Rows per query. Queries it cannot answer are left out of the map. */
  resolve(queries: readonly string[]): Promise<Map<string, ShardRow[]>>;
}
