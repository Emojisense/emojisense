import { describe, expect, it } from "vitest";
import {
  decodeVectors,
  encodeVectors,
  l2normalize,
  searchVectorSets,
  searchVectors,
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
});
