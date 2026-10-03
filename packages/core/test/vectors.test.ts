import { describe, expect, it } from "vitest";
import { GLYPH_WEIGHT, scoreSemanticRows } from "../src/semantic-policy.js";
import {
  decodeVectors,
  encodeVectors,
  glyphScores,
  l2normalize,
  searchVectorSets,
  searchVectors,
  semanticRows,
} from "../src/vectors.js";

const random = (dims: number, seed: number) => {
  let s = seed;
  return l2normalize(
    Float32Array.from({ length: dims }, () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648 - 0.5;
    }),
  );
};

describe("vector index", () => {
  const ids = ["1F600", "1F680", "1F996", "1F410"];
  const rows = ids.map((_, i) => random(64, i + 1));
  const decoded = decodeVectors(encodeVectors("test-model", ids, rows));

  it("round-trips metadata", () => {
    expect(decoded.model).toBe("test-model");
    expect(decoded.dims).toBe(64);
    expect(decoded.ids).toEqual(ids);
    expect(decoded.signs.length).toBe((ids.length * 64) / 8);
  });

  it("keeps int8 quantization error small", () => {
    for (let i = 0; i < rows.length * 64; i++) {
      const original = (rows[Math.floor(i / 64)] as Float32Array)[i % 64] as number;
      expect(Math.abs((decoded.data[i] as number) - original)).toBeLessThan(0.01);
    }
  });

  it("finds the nearest row first", () => {
    const [best] = searchVectors(decoded, rows[2] as Float32Array, 2);
    expect(best?.id).toBe("1F996");
    expect(best?.score).toBeGreaterThan(0.99);
  });

  it("round-trips an empty index", () => {
    const empty = decodeVectors(encodeVectors("m", [], []));
    expect(empty.ids).toEqual([]);
    expect(searchVectors({ ...empty, dims: 4 }, new Float32Array(4))).toEqual([]);
  });

  it("rejects a dimension mismatch", () => {
    expect(() => searchVectors(decoded, new Float32Array(32))).toThrow("dims");
    expect(() => searchVectorSets([decoded, decoded], new Float32Array(32))).toThrow("dims");
  });
});

describe("searchVectorSets", () => {
  const ids = ["1F600", "1F680", "1F996"];
  const shared = decodeVectors(
    encodeVectors(
      "m",
      ids,
      ids.map((_, i) => random(64, i + 1)),
    ),
  );
  // A locale's own rows: 1F996's row is the query itself, 1F680 has no row at all.
  const query = random(64, 99);
  const locale = decodeVectors(encodeVectors("m", ["1F996", "1F600"], [query, random(64, 7)]));

  it("scores each emoji by its best row over all indexes", () => {
    const matches = searchVectorSets([shared, locale], query, 3);
    expect(matches.map((m) => m.id).sort()).toEqual([...ids].sort());
    expect(matches[0]).toMatchObject({ id: "1F996", index: 0 });
    expect(matches[0]?.score).toBeGreaterThan(0.99);
    const own = (id: string) => searchVectors(shared, query, 3).find((m) => m.id === id)?.score;
    expect(matches.find((m) => m.id === "1F680")?.score).toBe(own("1F680"));
    expect(matches.find((m) => m.id === "1F600")?.score).toBeGreaterThanOrEqual(own("1F600") as number);
  });

  it("equals searchVectors for one index, and keeps the top k", () => {
    expect(searchVectorSets([shared], query, 2)).toEqual(searchVectors(shared, query, 2));
    expect(searchVectorSets([shared, locale], query, 1)).toHaveLength(1);
    expect(searchVectorSets([], query)).toEqual([]);
  });

  it("adds the bonus to an emoji's best row before ranking", () => {
    const plain = searchVectorSets([shared, locale], query, 3);
    const bonus = (id: string) => (id === "1F680" ? 2 : 0);
    const boosted = searchVectorSets([shared, locale], query, 3, { bonus });
    expect(boosted[0]?.id).toBe("1F680");
    expect(boosted[0]?.score).toBeCloseTo((plain.find((m) => m.id === "1F680")?.score as number) + 2);
    expect(searchVectors(shared, query, 1, { bonus })[0]?.id).toBe("1F680");
  });
});

describe("semanticRows (model output)", () => {
  const unit = (values: number[]) => l2normalize(Float32Array.from([...values, 0, 0, 0, 0]));
  const ids = ["A", "B", "C", "D"];
  // Text: A best, then B, C, D. Glyph rows for B and D only; D is closest by glyph.
  const text = decodeVectors(
    encodeVectors("m", ids, [
      unit([1, 0, 0, 0]),
      unit([0.9, 0.4, 0, 0]),
      unit([0.5, 0.8, 0, 0]),
      unit([0, 0, 1, 0]),
    ]),
  );
  const glyph = decodeVectors(encodeVectors("m", ["B", "D"], [unit([0, 1, 0, 0]), unit([1, 0, 0, 0])]));
  const query = unit([1, 0, 0, 0]);
  const emojiOf = (id: string) => `e${id}`;

  it("centres glyph cosines per query", () => {
    const scores = glyphScores(glyph, query);
    expect(scores.get("D")).toBeCloseTo(0.5, 2);
    expect(scores.get("B")).toBeCloseTo(-0.5, 2);
    expect(scores.has("A")).toBe(false);
  });

  it("keeps the best by text plus the best by glyph, chosen without any ranking policy", () => {
    const rows = semanticRows([text], query, { glyph, emojiOf, text: 2, glyphs: 1 });
    expect(rows.map((r) => r[1])).toEqual(["A", "B", "D"]);
    expect(rows[0]).toEqual(["eA", "A", 1, 0]);
    expect(rows[2]?.[3]).toBeCloseTo(0.5, 2);
    expect(semanticRows([text], query, { emojiOf, text: 2 }).map((r) => r[3])).toEqual([0, 0]);
  });

  it("is ranked by the policy on read: text cosine plus the weighted glyph term", () => {
    const ranked = scoreSemanticRows(semanticRows([text], query, { glyph, emojiOf }), 4);
    const b = ranked.find((r) => r.id === "B");
    expect(b?.score).toBeCloseTo(0.914 + GLYPH_WEIGHT * -0.5, 2);
    expect(ranked.map((r) => r.score)).toEqual([...ranked.map((r) => r.score)].sort((x, y) => y - x));
  });
});
