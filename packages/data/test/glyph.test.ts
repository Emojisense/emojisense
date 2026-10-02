import { decodeVectors, encodeVectors, l2normalize } from "emojisense/vectors";
import { describe, expect, it } from "vitest";
import { buildGlyphTexts, glyphBase, type PhraseSource, usagePhrases } from "../src/glyph-documents.ts";
import { degenerateRows, GLYPH_WEIGHT, glyphBonus, semanticBonus } from "../src/semantic-score.ts";
import type { BaseEmoji, LocaleEnrichment } from "../src/types.ts";

const block = (lists: Partial<LocaleEnrichment>): LocaleEnrichment => ({
  desc: "",
  synonym: [],
  slang: [],
  pop_culture: [],
  dev: [],
  typo: [],
  intent: [],
  low: [],
  ...lists,
});
const emoji = (hexcode: string, glyph: string, label: string): BaseEmoji => ({
  hexcode,
  emoji: glyph,
  label,
  tags: [],
  shortcodes: [],
  group: "smileys-emotion",
  subgroup: "",
  order: 0,
  version: 1,
  skins: [],
  i18n: {},
});

describe("glyph documents", () => {
  it("maps a gender variant to its base glyph", () => {
    expect(glyphBase("🤦‍♂️")).toBe("🤦");
    expect(glyphBase("👍🏽")).toBe("👍");
    expect(glyphBase("👨‍⚕️")).toBe("👨‍⚕️");
  });

  it("takes usage phrases from top, intent, slang and synonyms, validated and not demoted", () => {
    const skull = block({
      top: ["I'm dead"],
      intent: ["that killed me", "so funny"],
      slang: ["ded"],
      synonym: ["skeleton head"],
      low: ["so funny"],
    });
    const validated = ["im dead", "that killed me", "so funny", "ded", "skeleton head"];
    expect(usagePhrases(skull, validated, 3)).toEqual(["I'm dead", "that killed me", "ded"]);
    expect(usagePhrases(skull, ["ded"], 3)).toEqual(["ded"]);
    expect(usagePhrases(undefined, validated, 3)).toEqual([]);
  });

  it("builds the bare glyph, name and usage lines, and variants inherit their base", () => {
    const list = [
      emoji("1F926", "🤦", "person facepalming"),
      emoji("1F926-200D-2642-FE0F", "🤦‍♂️", "man facepalming"),
    ];
    const phrases: PhraseSource = new Map([["en", new Map([["1F926", block({ intent: ["smh"] })]])]]);
    const validated = { "1F926": { en: { alias: ["smh"] } } };
    const texts = buildGlyphTexts(list, phrases, validated, { kinds: ["glyph", "name", "context"] });
    expect(texts.map((t) => `${t.hexcode} ${t.kind} ${t.text}`)).toEqual([
      "1F926 glyph 🤦",
      "1F926 name 🤦 person facepalming",
      "1F926 context smh 🤦",
      "1F926-200D-2642-FE0F glyph 🤦",
      "1F926-200D-2642-FE0F name 🤦 person facepalming",
      "1F926-200D-2642-FE0F context smh 🤦",
    ]);
    const own = buildGlyphTexts(list, phrases, validated, { kinds: ["glyph"], inherit: false });
    expect(own.map((t) => t.text)).toEqual(["🤦", "🤦‍♂️"]);
  });
});

describe("semantic score", () => {
  const unit = (values: number[]) => l2normalize(Float32Array.from(values));
  const index = (ids: string[], rows: number[][]) =>
    decodeVectors(
      encodeVectors(
        "m",
        ids,
        rows.map((r) => unit(r)),
      ),
    );

  it("centres the glyph term on the query's mean glyph cosine; an emoji without a row adds 0", () => {
    const glyph = index(
      ["A", "B", "B"],
      [
        [1, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, 0],
        [0.6, 0.8, 0, 0, 0, 0, 0, 0],
      ],
    );
    const bonus = glyphBonus(glyph, unit([1, 0, 0, 0, 0, 0, 0, 0]));
    // A: cosine 1, B: best row 0.6; mean 0.8.
    expect(bonus("A")).toBeCloseTo(GLYPH_WEIGHT * 0.2, 2);
    expect(bonus("B")).toBeCloseTo(GLYPH_WEIGHT * -0.2, 2);
    expect(bonus("C")).toBe(0);
    const total = semanticBonus((id) => (id === "C" ? 1 : 0), glyph, unit([1, 0, 0, 0, 0, 0, 0, 0]));
    expect(total("C")).toBeCloseTo(0.04);
    expect(semanticBonus(() => 0.5, undefined, unit([1, 0, 0, 0, 0, 0, 0, 0]))("A")).toBeCloseTo(0.02);
  });

  it("finds rows that one unknown-token vector repeats over many texts", () => {
    const same = [0, 0, 1, 0, 0, 0, 0, 0];
    const rows = index(["a", "b", "c", "d", "e"], [same, same, same, same, [1, 0, 0, 0, 0, 0, 0, 0]]);
    expect([...degenerateRows(rows)]).toEqual([0, 1, 2, 3]);
    expect(degenerateRows(rows, 5).size).toBe(0);
  });
});
