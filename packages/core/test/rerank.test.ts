import { describe, expect, it } from "vitest";
import type { AliasResult, AliasSearchOutput, SearchResult } from "../src/engine.js";
import { fuse } from "../src/fusion.js";
import { RERANK_WEIGHTS, type RerankInput, rerank, rerankFeatures } from "../src/rerank.js";

const aliasHit = (id: string, score: number, match = "q"): AliasResult => ({
  emoji: id,
  id,
  score,
  source: "alias",
  label: id,
  match,
  field: "alias",
});
const semanticHit = (id: string, score: number): SearchResult => ({
  emoji: id,
  id,
  score,
  source: "semantic",
});
const aliasOutput = (results: AliasResult[]): AliasSearchOutput => ({
  query: "q",
  tokens: ["q"],
  confidence: results[0]?.score ?? 0,
  results,
});
const input = (
  alias: AliasResult[],
  semantic: SearchResult[],
  extra: Partial<RerankInput> = {},
): RerankInput => ({
  alias: aliasOutput(alias),
  semantic,
  semanticConfidence: 0.5,
  ...extra,
});
const ids = (list: readonly SearchResult[]) => list.map((r) => r.id);

describe("rerankFeatures", () => {
  it("describes a candidate by both lists and the confidences, never by how often it is used", () => {
    const features = rerankFeatures(
      input([aliasHit("A", 0.8), aliasHit("B", 0.4)], [semanticHit("S", 0.6), semanticHit("B", 0.5)]),
      "B",
    );
    // present, score, 1/rank, score/confidence, semantic score, gap, ×alias conf, ×semantic conf
    const expected = [1, 0.4, 1 / 2, 0.5, 0.5, 0.1, 0.32, 0.25];
    features.forEach((value, i) => {
      expect(value).toBeCloseTo(expected[i] as number);
    });
    expect(features).toHaveLength(RERANK_WEIGHTS.length);
  });

  it("scores a candidate missing from the semantic list just below its lowest result", () => {
    const features = rerankFeatures(
      input([aliasHit("A", 0.6)], [semanticHit("S", 0.6), semanticHit("T", 0.5)]),
      "A",
    );
    expect(features[4]).toBeCloseTo(0.48);
    expect(features[5]).toBeCloseTo(0.12);
    expect(rerankFeatures(input([aliasHit("A", 0.6)], []), "A")[4]).toBe(0);
  });
});

describe("rerank", () => {
  it("keeps alias results of 0.9 and more on top in alias order", () => {
    const out = rerank(input([aliasHit("A", 0.95), aliasHit("B", 0.92)], [semanticHit("S", 0.9)]), 3);
    expect(ids(out)).toEqual(["A", "B", "S"]);
  });

  it("puts a candidate both lists hold above one that only one list holds", () => {
    const alias = [aliasHit("A", 0.5), aliasHit("B", 0.5)];
    expect(ids(rerank(input(alias, [semanticHit("B", 0.55), semanticHit("C", 0.5)]), 3))).toEqual([
      "B",
      "A",
      "C",
    ]);
  });

  it("keeps the order of otherwise equal candidates", () => {
    const alias = [aliasHit("A", 0.5), aliasHit("B", 0.5)];
    expect(ids(rerank(input(alias, []), 2))).toEqual(["A", "B"]);
  });

  it("uses the weights it is given", () => {
    const only = (index: number) => RERANK_WEIGHTS.map((_, i) => (i === index ? 1 : 0));
    const list = input([aliasHit("A", 0.5)], [semanticHit("S", 0.7)]);
    expect(ids(rerank(list, 2, only(1)))).toEqual(["A", "S"]);
    expect(ids(rerank(list, 2, only(4)))).toEqual(["S", "A"]);
  });
});

describe("fuse (the reranker by default)", () => {
  it("ranks semantic country flags the alias tier does not hold after the other results", () => {
    const flag = { emoji: "🇧🇹", id: "1F1E7-1F1F9", score: 0.47, source: "semantic" as const };
    const out = fuse(aliasOutput([aliasHit("😄", 0.26)]), [flag, semanticHit("🐰", 0.43)], 4);
    expect(out.at(-1)?.id).toBe("1F1E7-1F1F9");
  });

  it("matches rerank when no flag is involved", () => {
    const alias = [aliasHit("A", 0.7), aliasHit("B", 0.6)];
    const semantic = [semanticHit("C", 0.62), semanticHit("A", 0.55), semanticHit("D", 0.5)];
    expect(ids(fuse(aliasOutput(alias), semantic, 4))).toEqual(
      ids(rerank({ alias: aliasOutput(alias), semantic, semanticConfidence: 1 }, 4)),
    );
  });
});

describe("number slang", () => {
  // zh "666": 👍 by its curated alias "666"; the embedding model reads the digits (6️⃣ first).
  const slang = (query: string, field: AliasResult["field"] = "alias"): RerankInput => ({
    alias: {
      query,
      tokens: [query],
      confidence: 0.82,
      results: [
        { ...aliasHit("👍", 0.82, query), field },
        aliasHit("🔥", 0.8, query),
        aliasHit("6️⃣", 0.661, `${query}6`),
      ],
    },
    semantic: [semanticHit("6️⃣", 0.586), semanticHit("🕕", 0.466), semanticHit("🐍", 0.436)],
    semanticConfidence: 1,
  });

  it("keeps the dictionary's whole-query answer first for a query of digits only", () => {
    expect(ids(rerank(slang("666"), 3))[0]).toBe("👍");
    expect(ids(rerank(slang("8 8"), 3))[0]).toBe("👍");
  });

  it("leaves other queries, weak fields and unsure dictionaries to the learned score", () => {
    expect(ids(rerank(slang("sss"), 3))[0]).toBe("6️⃣");
    expect(ids(rerank(slang("666", "low"), 3))[0]).toBe("6️⃣");
    const unsure = slang("666");
    expect(ids(rerank({ ...unsure, alias: { ...unsure.alias, confidence: 0.5 } }, 3))[0]).toBe("6️⃣");
  });
});
