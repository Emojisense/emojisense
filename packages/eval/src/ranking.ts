/**
 * The ranking every eval suite uses: what the Search API and the clients do (PACK_FORMAT.md §4,
 * §5, §10). `EMOJISENSE_RANKING` picks another variant, to compare them on the same queries:
 *
 *   shipped (default)  popularity tie-break; semantic score + popularity prior + glyph term (when
 *                      the pack has a glyph vector file); learned fusion
 *   no-glyph           shipped without the glyph term
 *   prior              popularity tie-break and prior, reciprocal rank fusion (`rerank: false`)
 *   rrf                none of them: the ranking before the popularity prior
 */
import { semanticBonus } from "@emojisense/data/semantic-score";
import {
  type AliasEngine,
  type AliasSearchOutput,
  createEngine,
  type EngineOptions,
  fuse,
  type Pack,
  type SearchResult,
  type SemanticCalibration,
} from "emojisense";
import { searchVectorSets } from "emojisense/vectors";
import type { VectorLayout } from "./vector-layout.ts";

export interface RankingVariant {
  name: string;
  /** Equal alias scores ordered by popularity (EngineOptions.popularity). */
  popularity: boolean;
  /** The popularity prior in semantic scores. */
  prior: boolean;
  /** The glyph term in semantic scores, when the pack has a glyph vector file. */
  glyph: boolean;
  /** Learned fusion (rerank.ts) instead of reciprocal rank fusion. */
  rerank: boolean;
}

export const RANKING_VARIANTS: Record<string, RankingVariant> = {
  shipped: { name: "shipped", popularity: true, prior: true, glyph: true, rerank: true },
  "no-glyph": { name: "no-glyph", popularity: true, prior: true, glyph: false, rerank: true },
  prior: { name: "prior", popularity: true, prior: true, glyph: false, rerank: false },
  rrf: { name: "rrf", popularity: false, prior: false, glyph: false, rerank: false },
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
  const popularity = (id: string) => (RANKING.prior ? engine.popularity(id) : 0);
  const bonus = RANKING.prior || glyph ? semanticBonus(popularity, glyph, query) : undefined;
  return searchVectorSets(layout.indexesFor(locale), query, k, bonus ? { bonus } : {}).map((m) => ({
    emoji: engine.get(m.id)?.emoji ?? "",
    id: m.id,
    score: m.score,
    source: "semantic" as const,
  }));
}

/**
 * `fuse` as the clients call it: with the engine's popularity. The reranker's weights belong to
 * the production model; another model or dims (`shipped: false`) fuses by reciprocal rank.
 */
export function fuseRanked(
  engine: AliasEngine,
  alias: AliasSearchOutput,
  semantic: readonly SearchResult[],
  limit: number,
  calibration?: SemanticCalibration,
  shipped = true,
): SearchResult[] {
  return fuse(alias, semantic, limit, calibration, {
    popularity: engine.popularity,
    rerank: RANKING.rerank && shipped,
  });
}
