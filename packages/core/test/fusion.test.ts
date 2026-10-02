import { describe, expect, it } from "vitest";
import type { AliasSearchOutput, SearchResult } from "../src/engine.js";
import { demoteUnsupportedFlags, fuse, fuseResults, semanticConfidence } from "../src/fusion.js";

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

  it("keeps alias results above the floor ahead of the rest, ordered by fused score", () => {
    const alias = [r("A", 0.8, "alias"), r("B", 0.78, "alias"), r("C", 0.6, "alias")];
    const semantic = [r("C", 0.5, "semantic"), r("B", 0.49, "semantic"), r("S", 0.48, "semantic")];
    expect(fuseResults(alias, semantic).map((x) => x.emoji)).toEqual(["C", "B", "A", "S"]);
    expect(fuseResults(alias, semantic, { aliasFloor: 0.7 }).map((x) => x.emoji)).toEqual([
      "B",
      "A",
      "C",
      "S",
    ]);
  });
});

describe("demoteUnsupportedFlags", () => {
  const flag = (hexcode: string, score: number, source: SearchResult["source"] = "semantic") => ({
    emoji: hexcode,
    id: hexcode,
    score,
    source,
  });
  const brazil = "1F1E7-1F1F7";
  const bhutan = "1F1E7-1F1F9";
  const scotland = "1F3F4-E0067-E0062-E0073-E0063-E0074-E007F";
  const chequered = "1F3C1";

  it("moves country and subdivision flags the alias tier does not hold after the other results", () => {
    const semantic = [
      flag(bhutan, 0.45),
      r("🐰", 0.44, "semantic"),
      flag(scotland, 0.43),
      flag(chequered, 0.42),
    ];
    expect(demoteUnsupportedFlags(semantic, []).map((x) => x.id)).toEqual([
      "🐰",
      chequered,
      bhutan,
      scotland,
    ]);
  });

  it("keeps a flag the alias results hold, or one with a cosine at the calibration ceiling", () => {
    const semantic = [flag(brazil, 0.5), flag(bhutan, 0.58), r("💛", 0.4, "semantic")];
    expect(demoteUnsupportedFlags(semantic, [flag(brazil, 0.86, "alias")])).toBe(semantic);
    expect(demoteUnsupportedFlags(semantic, []).map((x) => x.id)).toEqual([bhutan, "💛", brazil]);
  });
});

describe("fuse with rerank: false (confidence-weighted reciprocal rank fusion)", () => {
  const rrf = (a: AliasSearchOutput, s: readonly SearchResult[], limit: number) =>
    fuse(a, s, limit, undefined, { rerank: false });
  const alias = (confidence: number, emoji: string[]): AliasSearchOutput => ({
    query: "q",
    tokens: ["q"],
    confidence,
    coverage: 1,
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
    expect(rrf(alias(0.45, ["A1", "A2"]), semantic(0.42), 4).map((x) => x.emoji)).toEqual([
      "A1",
      "A2",
      "S1",
      "S2",
    ]);
  });

  it("keeps a sure alias top above a weaker alias hit that the semantic list favours", () => {
    // zh "666": 👍 0.82 and 🔥 0.80 by alias; the keycap 6 has a weak alias (0.66) and leads a
    // weak semantic list. Without the floor it went first.
    const out: AliasSearchOutput = {
      ...alias(0.82, []),
      results: (
        [
          ["👍", 0.82],
          ["🔥", 0.8],
          ["6️⃣", 0.66],
        ] as const
      ).map(([e, score]) => ({
        ...r(e, score, "alias"),
        source: "alias",
        label: e,
        match: "666",
        field: "alias",
      })),
    };
    const semantic = [r("6️⃣", 0.46, "semantic"), r("🕕", 0.45, "semantic"), r("7️⃣", 0.43, "semantic")];
    expect(rrf(out, semantic, 4).map((x) => x.emoji)).toEqual(["👍", "🔥", "6️⃣", "🕕"]);
  });

  it("lets the semantic list break near-ties among the top alias results", () => {
    const out = alias(0.78, ["🪨", "🚀"]);
    expect(rrf(out, [r("🚀", 0.51, "semantic"), r("🦝", 0.5, "semantic")], 3).map((x) => x.emoji)).toEqual([
      "🚀",
      "🪨",
      "🦝",
    ]);
  });

  it("ranks semantic country flags the alias tier does not hold after the other results", () => {
    const bhutan = { emoji: "🇧🇹", id: "1F1E7-1F1F9", score: 0.44, source: "semantic" as const };
    const fused = rrf(alias(0.26, ["😄"]), [bhutan, r("🐰", 0.43, "semantic"), r("🐇", 0.42, "semantic")], 4);
    expect(fused.map((x) => x.emoji)).toEqual(["😄", "🐰", "🐇", "🇧🇹"]);
  });

  it("still lets a sure semantic list lead an unsure alias list", () => {
    expect(rrf(alias(0.45, ["A1", "A2"]), semantic(0.7), 4).map((x) => x.emoji)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
    ]);
  });
});
