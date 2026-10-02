import type { AliasSearchOutput, SearchResult } from "./engine.js";

export interface FuseOptions {
  /** Reciprocal-rank-fusion constant. Default 60. */
  k?: number;
  limit?: number;
  /** Alias results at or above this score keep their place on top, so results do not jump. */
  pinScore?: number;
  aliasWeight?: number;
  semanticWeight?: number;
}

/**
 * Merge alias (Tier 0) and semantic (Tier 1) rankings with weighted reciprocal rank fusion.
 * Confident alias hits stay pinned in their original order, so the list does not flicker
 * when semantic results arrive. Each result keeps the object (and `source`) of its best list.
 */
export function fuseResults(
  alias: readonly SearchResult[],
  semantic: readonly SearchResult[],
  options: FuseOptions = {},
): SearchResult[] {
  const { k = 60, limit = 24, pinScore = 0.9, aliasWeight = 1, semanticWeight = 1 } = options;
  const pinned = alias.filter((r) => r.score >= pinScore);
  const pinnedIds = new Set(pinned.map((r) => r.id));
  const fused = new Map<string, { result: SearchResult; score: number }>();

  const accumulate = (list: readonly SearchResult[], weight: number) => {
    list.forEach((result, rank) => {
      if (pinnedIds.has(result.id)) return;
      const contribution = weight / (k + rank + 1);
      const current = fused.get(result.id);
      if (current) current.score += contribution;
      else fused.set(result.id, { result, score: contribution });
    });
  };
  accumulate(alias, aliasWeight);
  accumulate(semantic, semanticWeight);

  const rest = [...fused.values()].sort((a, b) => b.score - a.score).map((entry) => entry.result);
  return [...pinned, ...rest].slice(0, limit);
}

/** Fusion with weights derived from how sure the alias engine is. */
export function fuse(alias: AliasSearchOutput, semantic: readonly SearchResult[], limit = 24) {
  return fuseResults(alias.results, semantic, {
    limit,
    aliasWeight: 0.4 + alias.confidence,
    semanticWeight: 1,
  });
}

/**
 * Should this query also go to the semantic tier? Yes when the alias engine is unsure, or when
 * the query is a multi-word phrase without a strong alias hit (conceptual queries).
 */
export function shouldUseSemantic(alias: AliasSearchOutput): boolean {
  if (alias.tokens.length === 0) return false;
  if (alias.confidence < 0.6) return true;
  return alias.tokens.length >= 2 && alias.confidence < 0.9;
}
