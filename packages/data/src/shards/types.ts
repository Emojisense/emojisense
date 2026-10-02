export type { Shard, ShardIndex } from "emojisense";

/** One precomputed semantic answer, as stored in a shard (PACK_FORMAT.md §6). */
export type ShardResult = [emoji: string, hexcode: string, score: number];

/** A normalized query with how often it was seen and in which UI locales. */
export interface QueryCount {
  q: string;
  n: number;
  locales: string[];
}

/**
 * Produces the results the API returns with `mode=semantic` for a query. Workers AI in
 * production, cached embeddings offline, a fake in tests and dry runs.
 */
export interface ShardResolver {
  /** Model tag written to index.json, e.g. "embeddinggemma@256". Shards are valid only for it. */
  readonly model: string;
  /** Results per query, best first. Queries it cannot answer are left out of the map. */
  resolve(queries: readonly string[], limit: number): Promise<Map<string, ShardResult[]>>;
}
