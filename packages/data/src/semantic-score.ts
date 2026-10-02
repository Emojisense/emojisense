/**
 * What the Search API adds to an emoji's best cosine before it ranks the semantic list
 * (PACK_FORMAT.md §5, "Semantic score"). The Worker, the shard builders and the eval share it.
 *
 *   score = best cosine over the shared and the locale's document rows
 *         + SEMANTIC_POPULARITY_WEIGHT × popularity (0–1, the English core pack's `popularity`)
 *         + GLYPH_WEIGHT × (glyph cosine − mean glyph cosine of the query), when a glyph file exists
 *
 * The glyph term: a lone glyph embeds near every other lone glyph (cosine ≈ 0.55 to most queries),
 * so its raw cosine would favour any emoji with a glyph row; centring per query keeps the
 * emoji-specific part. An emoji without a glyph row (the model does not know its glyph) adds 0.
 */
import type { VectorIndex } from "emojisense/vectors";

/** Weight of the popularity prior: semantic-only recall@5 +4 to +5 points on the dev suites. */
export const SEMANTIC_POPULARITY_WEIGHT = 0.04;
/** Weight of the glyph term, chosen on the in-house and dev suites (DECISIONS.md). */
export const GLYPH_WEIGHT = 0.25;

/** `GLYPH_WEIGHT × (best glyph cosine − mean over the emoji with a glyph row)` per emoji id. */
export function glyphBonus(
  glyph: VectorIndex,
  query: Float32Array,
  weight = GLYPH_WEIGHT,
): (id: string) => number {
  const { data, dims, ids } = glyph;
  const best = new Map<string, number>();
  for (let r = 0; r < ids.length; r++) {
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += (data[r * dims + d] as number) * (query[d] as number);
    const id = ids[r] as string;
    if (dot > (best.get(id) ?? Number.NEGATIVE_INFINITY)) best.set(id, dot);
  }
  let sum = 0;
  for (const value of best.values()) sum += value;
  const mean = best.size ? sum / best.size : 0;
  return (id) => {
    const value = best.get(id);
    return value === undefined ? 0 : weight * (value - mean);
  };
}

/** The bonus of one query: the popularity prior plus, with a non-empty glyph index, the glyph term. */
export function semanticBonus(
  popularity: (id: string) => number,
  glyph: VectorIndex | undefined,
  query: Float32Array,
): (id: string) => number {
  const glyphTerm = glyph && glyph.ids.length > 0 ? glyphBonus(glyph, query) : undefined;
  return (id) => SEMANTIC_POPULARITY_WEIGHT * popularity(id) + (glyphTerm?.(id) ?? 0);
}

/** Rows whose vector repeats on ≥ `owners` distinct ids: the model read their texts as unknown tokens. */
export function degenerateRows(index: VectorIndex, owners = 4): Set<number> {
  const key = (r: number) =>
    Array.from(index.data.subarray(r * index.dims, r * index.dims + Math.min(24, index.dims)), (v) =>
      v.toFixed(3),
    ).join(",");
  const byKey = new Map<string, Set<string>>();
  index.ids.forEach((id, r) => {
    const k = key(r);
    byKey.set(k, (byKey.get(k) ?? new Set<string>()).add(id));
  });
  const out = new Set<number>();
  index.ids.forEach((_, r) => {
    if ((byKey.get(key(r))?.size ?? 0) >= owners) out.add(r);
  });
  return out;
}
