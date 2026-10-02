import { describe, expect, it } from "vitest";
import { decodeVectors, encodeVectors, l2normalize, searchVectors } from "../src/vectors.js";

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

  it("rejects a dimension mismatch", () => {
    expect(() => searchVectors(decoded, new Float32Array(32))).toThrow("dims");
  });
});
