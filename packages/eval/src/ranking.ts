/**
 * The ranking every eval suite uses: what the Search API and the clients do (PACK_FORMAT.md §4,
 * §5, §10). `EMOJISENSE_RANKING` picks another variant, to compare them on the same queries:
 *
 *   shipped (default)  popularity breaks equal alias scores only; semantic score = the policy over
 *                      the model output (core semantic-policy.ts); learned fusion
 *   no-glyph           shipped without the glyph term
 *   rrf                reciprocal rank fusion, no tie-break, no glyph term
 */
import {
  type AliasEngine,
  type AliasSearchOutput,
  createEngine,
  type EngineOptions,
  fuse,
  type Pack,
  type SearchResult,
  type SemanticCalibration,
  scoreSemanticRows,
} from "emojisense";
import { searchVectorSets, semanticRows } from "emojisense/vectors";
import type { VectorLayout } from "./vector-layout.ts";

export interface RankingVariant {
  name: string;
  /** Equal alias scores ordered by popularity (EngineOptions.popularity). */
  popularity: boolean;
  /** The glyph term in semantic scores, when the pack has a glyph vector file. */
  glyph: boolean;
  /** Learned fusion (rerank.ts) instead of reciprocal rank fusion. */
  rerank: boolean;
}

export const RANKING_VARIANTS: Record<string, RankingVariant> = {
  shipped: { name: "shipped", popularity: true, glyph: true, rerank: true },
  "no-glyph": { name: "no-glyph", popularity: true, glyph: false, rerank: true },
  rrf: { name: "rrf", popularity: false, glyph: false, rerank: false },
};

function variantOf(name: string): RankingVariant {
  const variant = RANKING_VARIANTS[name];
  if (!variant) {
    throw new Error(`EMOJISENSE_RANKING="${name}" (known: ${Object.keys(RANKING_VARIANTS).join(", ")})`);
  }
  return variant;
}

export const RANKING = variantOf(process.env.EMOJISENSE_RANKING || "shipped");
if (RANKING.name !== "shipped") console.warn(`ranking variant: ${RANKING.name}`);

/** An alias engine with the variant's tie-break. */
export function rankingEngine(packs: Pack[], options: EngineOptions = {}): AliasEngine {
  return createEngine(packs, { popularity: RANKING.popularity, ...options });
}

/** The semantic list of the Search API (worker/src/semantic.ts) for one query. */
export function semanticSearch(
  engine: AliasEngine,
  layout: VectorLayout,
  locale: string,
  query: Float32Array,
  k = 24,
): SearchResult[] {
  const glyph = RANKING.glyph ? layout.glyph : undefined;
  const rows = semanticRows(layout.indexesFor(locale), query, {
    glyph,
    emojiOf: (id) => engine.get(id)?.emoji ?? "",
  });
  return scoreSemanticRows(rows, k);
}

/**
 * The model's own list: best text cosine per emoji, no glyph term and no policy. The reference
 * for fidelity (how much of it a ranking keeps).
 */
export function modelSearch(
  engine: AliasEngine,
  layout: VectorLayout,
  locale: string,
  query: Float32Array,
  k = 10,
): string[] {
  return searchVectorSets(layout.indexesFor(locale), query, k).map((m) => engine.get(m.id)?.emoji ?? "");
}

/**
 * `fuse` as the clients call it. The reranker's weights belong to the production model; another
 * model or dims (`shipped: false`) fuses by reciprocal rank.
 */
export function fuseRanked(
  alias: AliasSearchOutput,
  semantic: readonly SearchResult[],
  limit: number,
  calibration?: SemanticCalibration,
  shipped = true,
): SearchResult[] {
  return fuse(alias, semantic, limit, calibration, { rerank: RANKING.rerank && shipped });
}
