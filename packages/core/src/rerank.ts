import type { AliasSearchOutput, SearchResult } from "./engine.js";

/**
 * Weights of the learned fusion (PACK_FORMAT.md §10), one per `rerankFeatures` value. Trained on
 * the in-house and dev suites (`pnpm --filter @emojisense/eval rerank:train`) for EmbeddingGemma
 * @768 with the semantic scores of semantic-policy.ts. No feature is a usage prior: what people
 * use most never outranks what the model and the dictionary found. The Swift and Kotlin ports use
 * the same.
 */
export const RERANK_WEIGHTS: readonly number[] = [-0.334, 1.59, 1.899, 0.3387, 10.67, -7.255, 1.838, 3.632];

export interface RerankInput {
  alias: AliasSearchOutput;
  semantic: readonly SearchResult[];
  /** How sure the semantic tier is, 0–1 (`semanticConfidence`). */
  semanticConfidence: number;
}

/**
 * The features of one candidate: alias present (0/1), alias score, 1 / alias rank, alias score /
 * alias confidence, semantic score (a candidate missing from the semantic list scores 0.02 below
 * its lowest), best semantic score − semantic score, alias score × alias confidence, semantic
 * score × semantic confidence.
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
    aliasScore * alias.confidence,
    score * semanticConfidence,
  ];
}

/** Fields whose match of the whole query is a curated answer: name, shortcode, keyword, alias. */
const CURATED_FIELDS = new Set<string>(["name", "shortcode", "keyword", "alias"]);
/** A normalized query of digits only: number slang such as zh 666, 88, 520. */
const DIGITS_ONLY = /^[0-9]+( [0-9]+)*$/;

/**
 * The dictionary's answer to number slang. The embedding model reads digits literally (zh "666" →
 * 6️⃣, "88" → 8️⃣); only the dictionary knows that 666 means "awesome" (👍) and 88 "bye" (👋).
 * For a query of digits only, a confident top result whose phrase is the whole query in a curated
 * field stays first. Other queries are left to the reranker: on the dev sets, pinning such a top
 * result for every query lost more first places than it won (DECISIONS.md).
 */
function numberSlangAnswer(alias: AliasSearchOutput): SearchResult | undefined {
  if (!DIGITS_ONLY.test(alias.query) || alias.confidence < 0.6) return undefined;
  const top = alias.results[0] as (SearchResult & { match?: string; field?: string }) | undefined;
  return top?.match === alias.query && CURATED_FIELDS.has(top.field ?? "") ? top : undefined;
}

/**
 * Alias results ≥ 0.9 stay on top in alias order (no flicker when semantic results arrive), and so
 * does the dictionary's answer to number slang (`numberSlangAnswer`); then every other candidate
 * of both lists by its learned score; ties keep alias-then-semantic order.
 */
export function rerank(input: RerankInput, limit: number, weights: readonly number[] = RERANK_WEIGHTS) {
  const pinned: SearchResult[] = input.alias.results.filter((r) => r.score >= 0.9);
  const slang = pinned.length === 0 ? numberSlangAnswer(input.alias) : undefined;
  if (slang) pinned.push(slang);
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
