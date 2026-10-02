import { describe, expect, it } from "vitest";
import type { AliasSearchOutput, SearchResult } from "../src/engine.js";
import { fuse, fuseResults, semanticConfidence } from "../src/fusion.js";

const r = (emoji: string, score: number, source: SearchResult["source"]): SearchResult => ({
  emoji,
  id: emoji,
  score,
  source,
});

describe("fuseResults", () => {
  it("keeps confident alias hits pinned on top in their order", () => {
    const alias = [r("🦖", 0.95, "alias"), r("🦕", 0.92, "alias"), r("🐊", 0.4, "alias")];
    const semantic = [r("🌋", 0.8, "semantic"), r("🦕", 0.7, "semantic"), r("🦖", 0.6, "semantic")];
    expect(fuseResults(alias, semantic).map((x) => x.emoji)).toEqual(["🦖", "🦕", "🌋", "🐊"]);
  });

  it("boosts items both tiers agree on", () => {
    const alias = [r("A", 0.5, "alias"), r("B", 0.4, "alias")];
    const semantic = [r("B", 0.9, "semantic"), r("C", 0.8, "semantic")];
    expect(fuseResults(alias, semantic)[0]?.emoji).toBe("B");
    expect(fuseResults(alias, semantic)[0]?.source).toBe("alias");
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => r(String(i), 0.1, "semantic"));
    expect(fuseResults([], many, { limit: 10 })).toHaveLength(10);
  });
});

describe("fuse", () => {
  const alias = (confidence: number, emoji: string[]): AliasSearchOutput => ({
    query: "q",
    tokens: ["q"],
    confidence,
    results: emoji.map((e, i) => ({
      ...r(e, confidence - i * 0.01, "alias"),
      source: "alias",
      label: e,
      match: "q",
      field: "alias",
    })),
  });
  const semantic = (best: number) =>
    ["S1", "S2", "S3", "S4"].map((e, i) => r(e, best - i * 0.01, "semantic"));

  it("maps the best cosine to 0–1 between the calibration floor and ceiling", () => {
    expect(semanticConfidence([])).toBe(0);
    expect(semanticConfidence(semantic(0.4))).toBe(0);
    expect(semanticConfidence(semantic(0.51))).toBeCloseTo(0.5);
    expect(semanticConfidence(semantic(0.8))).toBe(1);
    expect(semanticConfidence([r("x", 0.3, "semantic"), r("y", 0.51, "semantic")])).toBeCloseTo(0.5);
    expect(semanticConfidence(semantic(0.5), { floor: 0.2, ceiling: 0.6 })).toBe(0.75);
  });

  it("keeps an unsure alias hit above a weak semantic list", () => {
    // Alias 0.45 → weight 0.85; semantic best 0.42 → weight 0.4. A fixed semantic weight of 1 won.
    expect(fuse(alias(0.45, ["A1", "A2"]), semantic(0.42), 4).map((x) => x.emoji)).toEqual([
      "A1",
      "A2",
      "S1",
      "S2",
    ]);
  });

  it("still lets a sure semantic list lead an unsure alias list", () => {
    expect(fuse(alias(0.45, ["A1", "A2"]), semantic(0.7), 4).map((x) => x.emoji)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
    ]);
  });
});
