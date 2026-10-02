import type { AliasSearchOutput, SearchResult } from "./engine.js";

/**
 * Weights of the learned fusion (PACK_FORMAT.md §10), one per `rerankFeatures` value. Trained on
 * the in-house and dev suites (`pnpm --filter @emojisense/eval rerank:train`) for bge-m3 @1024
 * with the popularity prior in the semantic scores. The Swift and Kotlin ports use the same.
 */
export const RERANK_WEIGHTS: readonly number[] = [
  0.04023, 1.781, 1.697, 0.8871, 13.72, -19.46, 2.342, 2.146, 3.891,
];

export interface RerankInput {
  alias: AliasSearchOutput;
  semantic: readonly SearchResult[];
  /** How sure the semantic tier is, 0–1 (`semanticConfidence`). */
  semanticConfidence: number;
  /** 0–1 (`AliasEngine.popularity`); 0 for every emoji when absent. */
  popularity?: ((id: string) => number) | undefined;
}

/**
 * The features of one candidate: alias present (0/1), alias score, 1 / alias rank, alias score /
 * alias confidence, semantic score (a candidate missing from the semantic list scores 0.02 below
 * its lowest), best semantic score − semantic score, popularity, alias score × alias confidence,
 * semantic score × semantic confidence.
 */
export function rerankFeatures(input: RerankInput, id: string): number[] {
  const { alias, semantic, semanticConfidence } = input;
  const rank = alias.results.findIndex((r) => r.id === id);
  const aliasScore = alias.results[rank]?.score ?? 0;
  let best = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (const r of semantic) {
    best = Math.max(best, r.score);
    lowest = Math.min(lowest, r.score);
  }
  const score = semantic.find((r) => r.id === id)?.score ?? (semantic.length ? lowest - 0.02 : 0);
  return [
    rank < 0 ? 0 : 1,
    aliasScore,
    rank < 0 ? 0 : 1 / (rank + 1),
    rank < 0 ? 0 : aliasScore / alias.confidence,
    score,
    best - score,
    input.popularity?.(id) ?? 0,
    aliasScore * alias.confidence,
    score * semanticConfidence,
  ];
}

/**
 * Alias results ≥ 0.9 stay on top in alias order (no flicker when semantic results arrive), then
 * every other candidate of both lists by its learned score; ties keep alias-then-semantic order.
 */
export function rerank(input: RerankInput, limit: number, weights: readonly number[] = RERANK_WEIGHTS) {
  const pinned = input.alias.results.filter((r) => r.score >= 0.9);
  const seen = new Set(pinned.map((r) => r.id));
  const rest: { result: SearchResult; score: number }[] = [];
  for (const result of [...input.alias.results, ...input.semantic]) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    const features = rerankFeatures(input, result.id);
    rest.push({ result, score: features.reduce((sum, x, i) => sum + x * (weights[i] ?? 0), 0) });
  }
  // Array.prototype.sort is stable: equal scores keep candidate order.
  rest.sort((a, b) => b.score - a.score);
  return [...pinned, ...rest.map((r) => r.result)].slice(0, limit);
}
