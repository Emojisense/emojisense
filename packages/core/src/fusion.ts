import type { AliasSearchOutput, SearchResult } from "./engine.js";
import { rerank } from "./rerank.js";

export interface FuseOptions {
  /** Reciprocal-rank-fusion constant. Default 60. */
  k?: number;
  limit?: number;
  /** Alias results at or above this score keep their place on top, so results do not jump. */
  pinScore?: number;
  /**
   * Alias results at or above this score (below `pinScore`) come before every other result,
   * ordered among themselves by fused score: semantic evidence breaks their near-ties, but it
   * cannot lift a clearly weaker alias hit or a semantic-only hit above them. Default: off.
   */
  aliasFloor?: number;
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
  const { k = 60, limit = 24, pinScore = 0.9, aliasWeight = 1, semanticWeight = 1, aliasFloor } = options;
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
  if (aliasFloor === undefined) return [...pinned, ...rest].slice(0, limit);
  const floored = new Set(alias.filter((r) => r.score >= aliasFloor).map((r) => r.id));
  return [
    ...pinned,
    ...rest.filter((r) => floored.has(r.id)),
    ...rest.filter((r) => !floored.has(r.id)),
  ].slice(0, limit);
}

/** Score ranges of the semantic model over which its top match goes from "rarely right" to "usually right". */
export interface SemanticCalibration {
  /** Best cosine. */
  floor: number;
  ceiling: number;
  /**
   * Gap between the best cosine and the mean of ranks 2–5. Optional: without it only the best
   * cosine counts. A name scores low on every emoji but clearly highest on one ("messi" → ⚽ 0.35,
   * the next four 0.24–0.28), so the gap knows it when the cosine does not.
   */
  gapFloor?: number;
  gapCeiling?: number;
}

/**
 * EmbeddingGemma @768 (the production model), scored by semantic-policy.ts. Best score on the
 * in-house set: `floor` = 25th percentile of the semantic misses, `ceiling` = median of the hits. Gap, on the reranker's
 * training sets: a top match is right 26% of the time below 0.02 and 94% above 0.10. Another model
 * or dims needs its own values; `pnpm eval` measures floor and ceiling (DECISIONS.md).
 */
export const DEFAULT_SEMANTIC_CALIBRATION: SemanticCalibration = {
  floor: 0.35,
  ceiling: 0.53,
  gapFloor: 0.02,
  gapCeiling: 0.1,
};

/**
 * Candidates each tier brings to fusion, however many results are shown. The reranker's features
 * read the lists (ranks, the lowest semantic score), so a shorter list would rank differently: a
 * client showing 12 results must fuse the same 24 candidates as the API.
 */
export const RANK_DEPTH = 24;

/** Ranks 2–5 whose mean the best score is compared with. */
const GAP_RANKS = 4;

const unit = (x: number) => Math.min(1, Math.max(0, x));

/** How sure the semantic tier is, 0–1: from its best cosine, or from how far that stands out (the larger). */
export function semanticConfidence(
  semantic: readonly SearchResult[],
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
): number {
  const scores = semantic.map((r) => r.score).sort((a, b) => b - a);
  const [best = 0, ...rest] = scores;
  const { floor, ceiling, gapFloor, gapCeiling } = calibration;
  const level = unit((best - floor) / (ceiling - floor));
  const next = rest.slice(0, GAP_RANKS);
  if (gapFloor === undefined || gapCeiling === undefined || next.length === 0) return level;
  const gap = best - next.reduce((sum, s) => sum + s, 0) / next.length;
  return Math.max(level, unit((gap - gapFloor) / (gapCeiling - gapFloor)));
}

const REGIONAL_INDICATOR_A = 0x1f1e6;
const REGIONAL_INDICATOR_Z = 0x1f1ff;
const BLACK_FLAG = 0x1f3f4;
const TAG_SPACE = 0xe0020;
const CANCEL_TAG = 0xe007f;

/** A country (two regional indicators) or subdivision (black flag + tags) flag, by hexcode. */
function isCountryFlag(id: string): boolean {
  const points = id.split("-").map((hex) => Number.parseInt(hex, 16));
  const [first = 0, second = 0] = points;
  if (points.length === 2) {
    return points.every((p) => p >= REGIONAL_INDICATOR_A && p <= REGIONAL_INDICATOR_Z);
  }
  return points.length > 2 && first === BLACK_FLAG && second >= TAG_SPACE && second <= CANCEL_TAG;
}

/**
 * The semantic list with its unsupported country flags moved after its other results. A flag is
 * supported when the alias results hold the same flag (the query names that country in a loaded
 * locale) or its cosine reaches the calibration ceiling. Short Latin-script queries the model
 * does not know (romanized Hindi, Bengali and Arabic, slang) land near the flag documents, whose
 * texts are mostly foreign names: without this, flags filled the top 5 of 19% of such queries.
 */
export function demoteUnsupportedFlags(
  semantic: readonly SearchResult[],
  alias: readonly SearchResult[],
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
): readonly SearchResult[] {
  const aliasIds = new Set(alias.map((r) => r.id));
  const supported = (r: SearchResult) =>
    !isCountryFlag(r.id) || aliasIds.has(r.id) || r.score >= calibration.ceiling;
  if (semantic.every(supported)) return semantic;
  return [...semantic.filter(supported), ...semantic.filter((r) => !supported(r))];
}

/** Alias results this close to a confident top score stay above the rest (`aliasFloor`). */
const ALIAS_BAND = 0.1;
/** Below this alias confidence the alias tier is unsure (as in `shouldUseSemantic`): no floor. */
const ALIAS_FLOOR_MIN_CONFIDENCE = 0.6;

/** How `fuse` orders the lists. Default: the learned reranker (rerank.ts). */
export interface FuseRanking {
  /** false = the confidence-weighted reciprocal rank fusion below (the ranking before the reranker). */
  rerank?: boolean;
  /** Learned-fusion weights; default `RERANK_WEIGHTS` (fitted for the production model). */
  weights?: readonly number[] | undefined;
}

/**
 * The learned reranker (rerank.ts) by default: confident alias hits (≥ 0.9) stay on top in alias
 * order, then every other candidate of both lists by a linear score over alias and semantic
 * scores, ranks, match kind and country flags.
 *
 * With `rerank: false`, fusion with weights from how sure each tier is. Alias: 0.4 + confidence. Semantic: 1 when its
 * best match is strong, down to 0.4 when it is weak (unknown slang, romanized text, a language
 * the model handles poorly), so a weak semantic list no longer outranks an alias hit. When the
 * alias tier is sure (confidence ≥ 0.6), its results within 0.1 of the top score stay first; the
 * semantic tier reorders them but cannot push in a clearly weaker one. Semantic country flags the
 * alias tier does not support go last (`demoteUnsupportedFlags`).
 */
export function fuse(
  alias: AliasSearchOutput,
  semantic: readonly SearchResult[],
  limit = 24,
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
  ranking: FuseRanking = {},
) {
  const guarded = demoteUnsupportedFlags(semantic, alias.results, calibration);
  if (ranking.rerank !== false) {
    const confidence = semanticConfidence(guarded, calibration);
    const input = {
      alias,
      semantic: guarded,
      semanticConfidence: confidence,
    };
    return demoteUnsupportedFlags(rerank(input, Infinity, ranking.weights), alias.results, calibration).slice(
      0,
      limit,
    );
  }
  return fuseResults(alias.results, guarded, {
    limit,
    aliasWeight: 0.4 + alias.confidence,
    semanticWeight: 0.4 + 0.6 * semanticConfidence(guarded, calibration),
    ...(alias.confidence >= ALIAS_FLOOR_MIN_CONFIDENCE ? { aliasFloor: alias.confidence - ALIAS_BAND } : {}),
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
