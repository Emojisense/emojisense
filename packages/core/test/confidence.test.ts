import { describe, expect, it } from "vitest";
import {
  aliasCovers,
  assessConfidence,
  SEMANTIC_SURE,
  semanticStrength,
  WHOLE_COVERAGE,
} from "../src/confidence.js";
import type { AliasSearchOutput, SearchResult } from "../src/engine.js";
import { DEFAULT_SEMANTIC_CALIBRATION } from "../src/fusion.js";

const result = (id: string, score: number, source: SearchResult["source"]): SearchResult => ({
  emoji: id,
  id,
  score,
  source,
});
const alias = (confidence: number, coverage: number, ids: string[] = ["A"]): AliasSearchOutput => ({
  query: "q",
  tokens: ["q"],
  confidence,
  coverage,
  results: ids.map((id, i) => ({
    ...result(id, confidence - i * 0.01, "alias"),
    source: "alias",
    label: id,
    match: "q",
    field: "alias",
  })),
});
/** A semantic list: `top`, then four results `gap` below it. */
const semantic = (top: number, gap: number) => [
  result("S1", top, "semantic"),
  ...["S2", "S3", "S4", "S5"].map((id) => result(id, top - gap, "semantic")),
];

describe("semanticStrength", () => {
  it("is 0 below the calibration floor and 1 for a clear top at the ceiling", () => {
    expect(semanticStrength(semantic(0.38, 0.01))).toBe(0);
    expect(semanticStrength(semantic(0.6, 0.1))).toBe(1);
  });

  it("halves the strength of a flat top", () => {
    const clear = semanticStrength(semantic(0.53, 0.06));
    const flat = semanticStrength(semantic(0.53, 0));
    expect(flat).toBeCloseTo(clear / 2, 5);
  });

  it("handles a list of one and an empty list", () => {
    expect(semanticStrength([result("S", 0.58, "semantic")])).toBe(1);
    expect(semanticStrength([])).toBe(0);
  });
});

describe("assessConfidence", () => {
  it("is sure when the dictionary covers the query with a confident top result", () => {
    expect(aliasCovers(alias(0.9, 1))).toBe(true);
    expect(assessConfidence(alias(0.9, 1), semantic(0.4, 0))).toEqual({ confidence: 0.9, unsure: false });
  });

  it("is unsure without coverage and with a flat or low semantic list", () => {
    // "kendrick lamar": one word matched, cosines 0.38–0.40.
    expect(assessConfidence(alias(0.3, 0.45), semantic(0.4, 0.01)).unsure).toBe(true);
    expect(assessConfidence(alias(0, 0, []), semantic(0.4, 0.01)).unsure).toBe(true);
  });

  it("is sure when the semantic list is strong, whatever the dictionary says", () => {
    expect(assessConfidence(alias(0.3, 0.45), semantic(0.6, 0.08))).toEqual({ confidence: 1, unsure: false });
    expect(assessConfidence(undefined, semantic(0.6, 0.08)).unsure).toBe(false);
  });

  it("does not count a whole match with a weak top result as coverage", () => {
    // "drake" → 🦆 by a weak field: the dictionary has the word, not the meaning.
    expect(aliasCovers(alias(0.58, 1))).toBe(false);
    expect(assessConfidence(alias(0.58, 1), semantic(0.47, 0.01)).unsure).toBe(true);
  });

  it("judges by the dictionary alone without a semantic list", () => {
    expect(assessConfidence(alias(0.9, 1), undefined).unsure).toBe(false);
    expect(assessConfidence(alias(0.7, 0.5), undefined)).toEqual({
      confidence: Math.round(0.7 * (0.5 / WHOLE_COVERAGE) * 1000) / 1000,
      unsure: true,
    });
  });

  it("never calls an empty query unsure", () => {
    expect(assessConfidence({ ...alias(0, 0, []), tokens: [] }, [])).toEqual({
      confidence: 0,
      unsure: false,
    });
  });

  it("uses one threshold for the semantic list", () => {
    expect(SEMANTIC_SURE).toBeGreaterThan(0);
    const { floor, ceiling } = DEFAULT_SEMANTIC_CALIBRATION;
    const justBelow = semantic(floor + (ceiling - floor) * (SEMANTIC_SURE - 0.01), 0.06);
    expect(assessConfidence(alias(0, 0, []), justBelow).unsure).toBe(true);
  });
});
