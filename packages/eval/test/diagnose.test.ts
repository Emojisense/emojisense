import type { Pack } from "emojisense";
import { describe, expect, it } from "vitest";
import {
  classifyMiss,
  countFailures,
  foldGender,
  isRomanized,
  parseReviewIds,
  type QueryEvidence,
  rankOf,
  renderCounts,
  vocabularyOf,
} from "../src/diagnose.ts";

/** Synthetic evidence: a miss in every mode unless a test says otherwise. */
const evidence = (fields: Partial<QueryEvidence> = {}): QueryEvidence => ({
  id: "x",
  locale: "en",
  q: "rainy monday",
  answers: ["🌧️"],
  normalized: "rainy monday",
  tokens: ["rainy", "monday"],
  unknownTokens: [],
  aliasTopMatch: "monday",
  lists: { alias: ["📅"], semantic: ["☀️"], fused: ["📅"], gated: ["📅"] },
  gateCalled: true,
  disputed: false,
  ...fields,
});

describe("ranks", () => {
  it("ignores U+FE0F, and folds ♂/♀ only when asked", () => {
    expect(rankOf(["🙂", "🌧"], ["🌧️"])).toBe(2);
    expect(rankOf(["🤦"], ["🤦‍♂️"])).toBe(0);
    expect(rankOf(["🤦"], ["🤦‍♂️"], foldGender)).toBe(1);
    expect(foldGender("🙋‍♀️")).toBe("🙋");
  });
});

describe("classifyMiss", () => {
  it("returns nothing for a hit, or for a mode without a list", () => {
    expect(classifyMiss(evidence({ lists: { alias: ["🌧️"] } }), "alias")).toBeUndefined();
    expect(classifyMiss(evidence({ lists: { alias: ["📅"] } }), "fused")).toBeUndefined();
  });

  it("puts label-side causes first", () => {
    expect(classifyMiss(evidence({ q: "rain 🌧️" }), "alias")).toBe("emoji-in-query");
    expect(classifyMiss(evidence({ answers: ["🤦‍♀️"], lists: { alias: ["🤦"] } }), "alias")).toBe(
      "gendered-label",
    );
    expect(classifyMiss(evidence({ disputed: true }), "alias")).toBe("disputed-label");
  });

  it("blames fusion only in the fused and gated modes", () => {
    const aliasHad = evidence({ lists: { alias: ["🌧️"], semantic: ["☀️"], fused: ["☀️"], gated: ["☀️"] } });
    expect(classifyMiss(aliasHad, "alias")).toBeUndefined();
    expect(classifyMiss(aliasHad, "fused")).toBe("fusion-dropped-alias");
    const semanticHad = evidence({ lists: { alias: ["📅"], semantic: ["🌧️"], fused: ["📅"], gated: ["📅"] } });
    expect(classifyMiss(semanticHad, "alias")).toBe("phrase-partial");
    expect(classifyMiss(semanticHad, "fused")).toBe("fusion-dropped-semantic");
    const skipped = evidence({ gateCalled: false, lists: { alias: ["📅"], fused: ["🌧️"], gated: ["📅"] } });
    expect(classifyMiss(skipped, "gated")).toBe("gate-skipped");
  });

  it("names the query form, then the vocabulary cause", () => {
    expect(classifyMiss(evidence({ locale: "hi", q: "baarish hai" }), "alias")).toBe("romanized");
    expect(classifyMiss(evidence({ locale: "zh", q: "晴天", unknownTokens: ["晴天"] }), "alias")).toBe(
      "unsegmented-script",
    );
    const { aliasTopMatch: _, ...nothing } = evidence();
    expect(classifyMiss(nothing, "alias")).toBe("no-match");
    expect(classifyMiss(evidence({ unknownTokens: ["rainy"] }), "alias")).toBe("unknown-word");
    expect(classifyMiss(evidence({ aliasTopMatch: "rainy monday" }), "alias")).toBe(
      "exact-phrase-other-emoji",
    );
    expect(classifyMiss(evidence(), "alias")).toBe("phrase-partial");
    expect(
      classifyMiss(evidence({ normalized: "rainy", tokens: ["rainy"], aliasTopMatch: "rainy day" }), "alias"),
    ).toBe("word-sense");
  });

  it("treats only Latin text of a locale with a romanized form as romanized", () => {
    expect(isRomanized("ar", "marhaba")).toBe(true);
    expect(isRomanized("ar", "مرحبا")).toBe(false);
    expect(isRomanized("ru", "privet")).toBe(true);
    expect(isRomanized("es", "hola")).toBe(false);
    expect(isRomanized("hi", "123")).toBe(false);
  });
});

describe("counts", () => {
  it("counts per type and locale, and renders only the types that occur", () => {
    const all = [
      evidence({ id: "a" }),
      evidence({ id: "b", locale: "tr" }),
      evidence({ id: "c", disputed: true }),
    ];
    const counts = countFailures(all, "alias");
    expect(counts["phrase-partial"]).toEqual({ en: 1, tr: 1, all: 2 });
    expect(counts["disputed-label"]).toEqual({ en: 1, all: 1 });
    const table = renderCounts(counts, ["en", "tr"], { en: 2, tr: 1, all: 3 });
    expect(table).toContain("| disputed-label | 1 | 0 | 1 |");
    expect(table).toContain("| **misses** | 2 | 1 | 3 |");
    expect(table).not.toContain("romanized");
  });
});

describe("inputs", () => {
  it("reads single ids and both range forms from the review file", () => {
    const ids = parseReviewIds("| held-en-030 | … held-ar-006 to held-ar-008, held-zh-068 to 070 |");
    expect([...ids].sort()).toEqual([
      "held-ar-006",
      "held-ar-007",
      "held-ar-008",
      "held-en-030",
      "held-zh-068",
      "held-zh-069",
      "held-zh-070",
    ]);
  });

  it("collects the tokens of labels and every phrase field", () => {
    const pack = {
      emoji: [["🌧️", "1F327", 0, 1, 0, "Cloud With Rain", "rain", "", "rainy day|drizzle", "", "wet"]],
    } as unknown as Pack;
    expect([...vocabularyOf([pack])].sort()).toEqual([
      "cloud",
      "day",
      "drizzle",
      "rain",
      "rainy",
      "wet",
      "with",
    ]);
  });
});
