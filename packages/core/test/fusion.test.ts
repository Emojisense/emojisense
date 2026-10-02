import { describe, expect, it } from "vitest";
import type { SearchResult } from "../src/engine.js";
import { fuseResults } from "../src/fusion.js";

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
