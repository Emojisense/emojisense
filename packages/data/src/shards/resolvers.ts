import { l2normalize, searchVectorSets, type VectorIndex } from "emojisense/vectors";
import type { ShardResolver, ShardResult } from "./types.ts";

/** Returns query vectors in input order; `undefined` where none is available (offline cache miss). */
export interface QueryEmbedder {
  embed(queries: readonly string[]): Promise<(Float32Array | undefined)[]>;
}

export interface VectorResolverOptions {
  /** e.g. "embeddinggemma@256" */
  tag: string;
  /**
   * The emoji vector files of the same model and dims: the shared file, and a locale's own file
   * for that locale's answers (each emoji scores its best row, as in the API).
   */
  index: VectorIndex | readonly VectorIndex[];
  /** The score bonus of one query (`semanticBonus` in semantic-score.ts), as the Worker adds it. */
  bonus?: (query: Float32Array) => (id: string) => number;
  emojiOf(hexcode: string): string | undefined;
  embedder: QueryEmbedder;
}

/**
 * The Worker's `mode=semantic` path, run in batch: embed, truncate to the index dims,
 * re-normalize, brute-force top-k over the vector files with the score bonus, round scores to
 * three decimals.
 */
export function createVectorResolver(options: VectorResolverOptions): ShardResolver {
  const { embedder, emojiOf, bonus } = options;
  const indexes: readonly VectorIndex[] = Array.isArray(options.index) ? options.index : [options.index];
  const dims = (indexes[0] as VectorIndex).dims;
  return {
    model: options.tag,
    async resolve(queries, limit) {
      const vectors = await embedder.embed(queries);
      const out = new Map<string, ShardResult[]>();
      queries.forEach((q, i) => {
        const vector = vectors[i];
        if (!vector || vector.length < dims) return;
        const query = l2normalize(vector.slice(0, dims));
        const matches = searchVectorSets(indexes, query, limit, bonus ? { bonus: bonus(query) } : {});
        out.set(
          q,
          matches.map((m): ShardResult => [emojiOf(m.id) ?? "", m.id, Math.round(m.score * 1000) / 1000]),
        );
      });
      return out;
    },
  };
}

/** FNV-1a: a stable 32-bit seed per query. */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic stand-in results from a real catalog, for tests and dry runs without Workers AI.
 * The emoji and hexcode lengths are realistic, so shard sizes are too; the rankings are not.
 */
export function createFakeResolver(
  catalog: readonly { emoji: string; id: string }[],
  tag = "fake@0",
): ShardResolver {
  return {
    model: tag,
    async resolve(queries, limit) {
      const out = new Map<string, ShardResult[]>();
      for (const q of queries) {
        const next = random(hashSeed(q));
        const picked = new Set<number>();
        const count = Math.min(limit, catalog.length);
        while (picked.size < count) picked.add(Math.floor(next() * catalog.length));
        let score = 0.6 + next() * 0.3;
        const results: ShardResult[] = [];
        for (const i of picked) {
          const entry = catalog[i] as { emoji: string; id: string };
          results.push([entry.emoji, entry.id, Math.round(score * 1000) / 1000]);
          score -= next() * 0.03;
        }
        out.set(q, results);
      }
      return out;
    },
  };
}
