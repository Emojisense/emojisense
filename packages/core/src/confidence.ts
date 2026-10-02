import type { AliasSearchOutput, SearchResult } from "./engine.js";
import { DEFAULT_SEMANTIC_CALIBRATION, type SemanticCalibration } from "./fusion.js";

/** At or above this `coverage` the alias dictionary explains the whole query. */
export const WHOLE_COVERAGE = 0.85;
/**
 * Below this semantic strength the semantic list is flat or low: the model matched the query to
 * nothing in particular ("kendrick lamar" → 🦁 🤦 🧙‍♂️ at cosines 0.38–0.40).
 */
export const SEMANTIC_SURE = 0.6;
/** The alias tier is unsure below this top score (as in `shouldUseSemantic`). */
const ALIAS_SURE = 0.6;
/** Results 2–5 whose mean the top cosine must clear to stand out. */
const SPREAD_RANKS = 5;
/** A top cosine this far above the next ones counts as a full calibration step (`ceiling − floor`). */
const SPREAD_FULL = 0.06;

export interface QueryConfidence {
  /** 0–1: how well the best tier understood the query. */
  confidence: number;
  /**
   * No tier understood the query: the dictionary does not cover its words and the semantic list
   * is flat or low. Show the results as guesses.
   */
  unsure: boolean;
}

/**
 * How strong a semantic list is, 0–1, from its final scores: the best cosine on the calibrated
 * scale, scaled down when the top does not stand out from results 2–5. This is the one place
 * that reads semantic scores for the unsure verdict, so a reranker can feed its own list here.
 */
export function semanticStrength(
  semantic: readonly SearchResult[],
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
): number {
  const scores = semantic.map((r) => r.score);
  const [top = 0, ...rest] = scores;
  const { floor, ceiling } = calibration;
  const level = Math.min(1, Math.max(0, (top - floor) / (ceiling - floor)));
  const next = rest.slice(0, SPREAD_RANKS - 1);
  if (next.length === 0) return level;
  const mean = next.reduce((sum, s) => sum + s, 0) / next.length;
  const spread = Math.min(1, Math.max(0, (top - mean) / SPREAD_FULL));
  // A flat top (nothing stands out) halves the strength; a clear one keeps it.
  return level * (0.5 + 0.5 * spread);
}

/**
 * The dictionary explains the whole query with confidence: one phrase matches all its words
 * (`coverage` ≥ 0.85, not one word of it or a part of a word) and the top result scores ≥ 0.6.
 * A whole match in a weak field ("drake" → 🦆 by a keyword, 0.58) is not enough on its own.
 */
export function aliasCovers(alias: AliasSearchOutput): boolean {
  return (alias.coverage ?? 0) >= WHOLE_COVERAGE && alias.confidence >= ALIAS_SURE;
}

/**
 * Is a query unsure? Yes when the dictionary does not cover it (`aliasCovers`) and the semantic
 * list is flat or low (`semanticStrength` < 0.6). Without a semantic list (not asked, offline,
 * over the limit), when the dictionary does not cover it. An empty query is never unsure.
 * Thresholds: DECISIONS.md, "Unsure queries and the concept tier" (the LLM tier is removed; the
 * verdict stays).
 */
export function assessConfidence(
  alias: AliasSearchOutput | undefined,
  semantic: readonly SearchResult[] | undefined,
  calibration: SemanticCalibration = DEFAULT_SEMANTIC_CALIBRATION,
): QueryConfidence {
  if (alias && alias.tokens.length === 0) return { confidence: 0, unsure: false };
  const aliasPart = alias ? alias.confidence * Math.min(1, (alias.coverage ?? 0) / WHOLE_COVERAGE) : 0;
  const covered = alias ? aliasCovers(alias) : false;
  if (semantic === undefined)
    return { confidence: round(aliasPart), unsure: alias !== undefined && !covered };
  const strength = semanticStrength(semantic, calibration);
  return { confidence: round(Math.max(aliasPart, strength)), unsure: !covered && strength < SEMANTIC_SURE };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
