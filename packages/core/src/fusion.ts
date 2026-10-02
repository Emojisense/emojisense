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

/** Cosine range of the semantic model over which its top match goes from "rarely right" to "usually right". */
export interface SemanticCalibration {
  floor: number;
  ceiling: number;
}

/**
 * bge-m3 @1024 (the production model) on the in-house set: `floor` = 25th percentile of the best
 * cosine of the semantic misses, `ceiling` = median best cosine of the hits (under a tenth of the
 * hits are below the floor). Another model or dims needs its own values; `pnpm eval` measures them
 * (DECISIONS.md, 2026-10-02 quality diagnosis).
 */
export const DEFAULT_SEMANTIC_CALIBRATION: SemanticCalibration = { floor: 0.44, ceiling: 0.58 };

/** How sure the semantic tier is, 0–1, from its best cosine score. */
export function semanticConfidence(
  semantic: readonly SearchResult[],
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
): number {
  const best = semantic.reduce((max, r) => Math.max(max, r.score), 0);
  const { floor, ceiling } = calibration;
  return Math.min(1, Math.max(0, (best - floor) / (ceiling - floor)));
}

/**
 * Fusion with weights from how sure each tier is. Alias: 0.4 + confidence. Semantic: 1 when its
 * best match is strong, down to 0.4 when it is weak (unknown slang, romanized text, a language
 * the model handles poorly), so a weak semantic list no longer outranks an alias hit.
 */
export function fuse(
  alias: AliasSearchOutput,
  semantic: readonly SearchResult[],
  limit = 24,
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
) {
  return fuseResults(alias.results, semantic, {
    limit,
    aliasWeight: 0.4 + alias.confidence,
    semanticWeight: 0.4 + 0.6 * semanticConfidence(semantic, calibration),
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
