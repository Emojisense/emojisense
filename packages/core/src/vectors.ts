/**
 * Emoji vector index, binary format v1 ("ESVEC1"). Normative spec: docs/PACK_FORMAT.md §Vectors.
 * int8 vectors with one float32 scale per row, plus sign bits for a binary shortlist.
 */
import type { SemanticRow } from "./semantic-policy.js";

const MAGIC = "ESVEC1\0\0";
const HEADER_BYTES = 32;

export interface VectorIndex {
  model: string;
  dims: number;
  /** Hexcodes, one per row, in pack order. */
  ids: string[];
  /** Dequantized, L2-normalized rows (count × dims). */
  data: Float32Array;
  /** Sign bits, `dims / 8` bytes per row (bit set = positive). */
  signs: Uint8Array;
}

export interface VectorMatch {
  index: number;
  id: string;
  score: number;
}

const align4 = (n: number) => (n + 3) & ~3;

/** L2-normalize in place (after Matryoshka truncation the norm is no longer 1). */
export function l2normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += (vector[i] as number) ** 2;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] as number) / norm;
  return vector;
}

/** Encode L2-normalized float rows. `dims` must be a multiple of 8. */
export function encodeVectors(model: string, ids: string[], rows: Float32Array[]): Uint8Array {
  const dims = rows[0]?.length ?? 0;
  if (dims % 8 !== 0) throw new Error("emojisense: vector dims must be a multiple of 8");
  if (rows.length !== ids.length) throw new Error("emojisense: ids and rows differ in length");
  const encoder = new TextEncoder();
  const modelBytes = encoder.encode(model);
  const idBytes = encoder.encode(ids.join("\n"));
  const count = rows.length;

  const modelOffset = HEADER_BYTES;
  const idsOffset = align4(modelOffset + modelBytes.length);
  const scalesOffset = align4(idsOffset + idBytes.length);
  const vectorsOffset = scalesOffset + count * 4;
  const signsOffset = vectorsOffset + count * dims;
  const total = signsOffset + (count * dims) / 8;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(encoder.encode(MAGIC), 0);
  view.setUint32(8, count, true);
  view.setUint32(12, dims, true);
  view.setUint32(16, modelBytes.length, true);
  view.setUint32(20, idBytes.length, true);
  out.set(modelBytes, modelOffset);
  out.set(idBytes, idsOffset);

  const quantized = new Int8Array(out.buffer, vectorsOffset, count * dims);
  rows.forEach((row, r) => {
    let maxAbs = 0;
    for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
    const scale = maxAbs / 127 || 1;
    view.setFloat32(scalesOffset + r * 4, scale, true);
    for (let d = 0; d < dims; d++) {
      const value = row[d] as number;
      quantized[r * dims + d] = Math.round(value / scale);
      if (value > 0) {
        const bit = r * dims + d;
        out[signsOffset + (bit >> 3)] = (out[signsOffset + (bit >> 3)] as number) | (1 << (bit & 7));
      }
    }
  });
  return out;
}

export function decodeVectors(buffer: ArrayBuffer | Uint8Array): VectorIndex {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error("emojisense: not an ESVEC1 file");
  const count = view.getUint32(8, true);
  const dims = view.getUint32(12, true);
  const modelLength = view.getUint32(16, true);
  const idsLength = view.getUint32(20, true);

  const modelOffset = HEADER_BYTES;
  const idsOffset = align4(modelOffset + modelLength);
  const scalesOffset = align4(idsOffset + idsLength);
  const vectorsOffset = scalesOffset + count * 4;
  const signsOffset = vectorsOffset + count * dims;

  const data = new Float32Array(count * dims);
  for (let r = 0; r < count; r++) {
    const scale = view.getFloat32(scalesOffset + r * 4, true);
    for (let d = 0; d < dims; d++) {
      data[r * dims + d] = view.getInt8(vectorsOffset + r * dims + d) * scale;
    }
  }
  return {
    model: decoder.decode(bytes.subarray(modelOffset, modelOffset + modelLength)),
    dims,
    ids: idsLength === 0 ? [] : decoder.decode(bytes.subarray(idsOffset, idsOffset + idsLength)).split("\n"),
    data,
    signs: bytes.slice(signsOffset, signsOffset + (count * dims) / 8),
  };
}

function scoreRows(index: VectorIndex, query: Float32Array): Float32Array {
  if (query.length !== index.dims) {
    throw new Error(`emojisense: query has ${query.length} dims, index has ${index.dims}`);
  }
  const { data, dims, ids } = index;
  const scores = new Float32Array(ids.length);
  for (let r = 0; r < ids.length; r++) {
    let dot = 0;
    const offset = r * dims;
    for (let d = 0; d < dims; d++) dot += (data[offset + d] as number) * (query[d] as number);
    scores[r] = dot;
  }
  return scores;
}

export interface VectorSearchOptions {
  /** Added to an emoji's best cosine before ranking; the match's `score` includes it. */
  bonus?: (id: string) => number;
}

/** Exact top-k by dot product (cosine for normalized rows). ~2k rows: well under 1 ms. */
export function searchVectors(
  index: VectorIndex,
  query: Float32Array,
  k = 24,
  options: VectorSearchOptions = {},
): VectorMatch[] {
  const scores = scoreRows(index, query);
  if (options.bonus) {
    const { bonus } = options;
    index.ids.forEach((id, i) => {
      scores[i] = (scores[i] as number) + bonus(id);
    });
  }
  const order = Array.from({ length: scores.length }, (_, i) => i);
  order.sort((a, b) => (scores[b] as number) - (scores[a] as number));
  return order.slice(0, k).map((i) => ({ index: i, id: index.ids[i] as string, score: scores[i] as number }));
}

/**
 * Top-k emoji over several indexes of one model and dims, e.g. the vectors of a pack's shared
 * documents and of one locale's documents (PACK_FORMAT §5). An emoji scores its best row; `index`
 * is that row's position in its own index. One index gives the same result as `searchVectors`.
 */
export function searchVectorSets(
  indexes: readonly VectorIndex[],
  query: Float32Array,
  k = 24,
  options: VectorSearchOptions = {},
): VectorMatch[] {
  if (indexes.length === 1) return searchVectors(indexes[0] as VectorIndex, query, k, options);
  const best = new Map<string, VectorMatch>();
  for (const index of indexes) {
    const scores = scoreRows(index, query);
    index.ids.forEach((id, row) => {
      const score = scores[row] as number;
      const current = best.get(id);
      if (!current || score > current.score) best.set(id, { index: row, id, score });
    });
  }
  const matches = [...best.values()];
  if (options.bonus) for (const m of matches) m.score += options.bonus(m.id);
  return matches.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Per emoji with a glyph row: its best glyph cosine minus the mean over all of them. A lone glyph
 * embeds near every other lone glyph (cosine ≈ 0.55 to most queries), so the raw cosine would
 * favour any emoji with a glyph row; centring per query keeps the emoji-specific part.
 */
export function glyphScores(glyph: VectorIndex, query: Float32Array): Map<string, number> {
  const scores = scoreRows(glyph, query);
  const best = new Map<string, number>();
  glyph.ids.forEach((id, row) => {
    const score = scores[row] as number;
    if (score > (best.get(id) ?? Number.NEGATIVE_INFINITY)) best.set(id, score);
  });
  let sum = 0;
  for (const value of best.values()) sum += value;
  const mean = best.size ? sum / best.size : 0;
  for (const [id, value] of best) best.set(id, value - mean);
  return best;
}

export interface SemanticRowOptions {
  /** The glyph vectors of the model; without them every row's glyph value is 0. */
  glyph?: VectorIndex | undefined;
  /** The emoji of an id, from the pack. */
  emojiOf: (id: string) => string;
  /** Candidates by text cosine. Default 32. */
  text?: number;
  /** More candidates by glyph cosine. Default 8. */
  glyphs?: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The model output of one query (semantic-policy.ts): the best emoji by text cosine plus the best
 * by glyph cosine, chosen without any ranking policy, in text order. 32 + 8 rows hold a policy
 * ranking's top 12 for 99.9% of the eval queries, so a later policy can rank them without the
 * embedding.
 */
export function semanticRows(
  indexes: readonly VectorIndex[],
  query: Float32Array,
  options: SemanticRowOptions,
): SemanticRow[] {
  const seen = new Set<string>();
  // One index can hold several rows of an emoji: keep its best.
  const all = searchVectorSets(indexes, query, Number.POSITIVE_INFINITY).filter(
    (m) => !seen.has(m.id) && seen.add(m.id),
  );
  const glyphs =
    options.glyph && options.glyph.ids.length > 0 ? glyphScores(options.glyph, query) : undefined;
  const chosen = all.slice(0, options.text ?? 32);
  if (glyphs) {
    const taken = new Set(chosen.map((m) => m.id));
    const byGlyph = all
      .filter((m) => !taken.has(m.id) && glyphs.has(m.id))
      .sort((a, b) => (glyphs.get(b.id) as number) - (glyphs.get(a.id) as number))
      .slice(0, options.glyphs ?? 8);
    chosen.push(...byGlyph.sort((a, b) => b.score - a.score));
  }
  return chosen.map((m) => [options.emojiOf(m.id), m.id, round3(m.score), round3(glyphs?.get(m.id) ?? 0)]);
}
