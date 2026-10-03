/**
 * The meaning search in two parts (PACK_FORMAT.md §5, "Semantic score").
 *
 * Model output: per candidate emoji, its best text cosine and its centered glyph cosine
 * (`semanticRows` in emojisense/vectors). It costs an embedding, so shards store it as it is.
 *
 * Ranking policy (this file): how those numbers become one score. It is cheap and runs on every
 * read, by the client for shards and by the API for its answers, so changing it needs neither a
 * new embedding nor a shard rebuild. It ranks by the model alone: no usage prior bends its order.
 */
import type { SearchResult } from "./engine.js";

/**
 * One candidate of the model output: `[emoji, id, best text cosine, glyph cosine − the query's
 * mean glyph cosine]`, both to three decimals. The glyph value is 0 for an emoji without a glyph
 * row (the model does not know its glyph).
 */
export type SemanticRow = [emoji: string, id: string, text: number, glyph: number];

/** Weight of the glyph term, chosen on the in-house and dev suites. */
export const GLYPH_WEIGHT = 0.25;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The policy's score of one row. */
export const semanticScore = ([, , text, glyph]: SemanticRow): number => round3(text + GLYPH_WEIGHT * glyph);

/** Rows ranked by the policy, best first; equal scores keep row order. */
export function scoreSemanticRows(
  rows: readonly SemanticRow[],
  limit = Number.POSITIVE_INFINITY,
): SearchResult[] {
  return rows
    .map(
      (row): SearchResult => ({ emoji: row[0], id: row[1], score: semanticScore(row), source: "semantic" }),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
