import { describe, expect, it } from "vitest";
import { type Curation, unmatchedEdits } from "../src/curation.ts";
import { cldrKeywords, packFields } from "../src/pack-fields.ts";
import type { BaseEmoji } from "../src/types.ts";
import type { ValidatedLocale } from "../src/validate.ts";

const hug: BaseEmoji = {
  hexcode: "1FAC2",
  emoji: "🫂",
  label: "people hugging",
  tags: ["goodbye", "hello", "hug", "thanks"],
  shortcodes: ["people_hugging"],
  group: "people-body",
  subgroup: "person-symbol",
  order: 0,
  version: 13,
  skins: [],
  i18n: { hi: { label: "गले मिलते हुए लोग", tags: ["अलविदा", "गले मिलते हुए लोग", "धन्यवाद", "दोस्ती"] } },
};
const validated: ValidatedLocale = { desc: "", alias: ["गले लगाना", "झप्पी"], typo: [], low: ["सहारा"] };
const fieldsWith = (curations: Curation[], locale = "hi") =>
  packFields(hug, locale, locale === "hi" ? validated : undefined, 1, curations);

describe("pack fields", () => {
  it("indexes CLDR keywords at keyword weight when no curation applies", () => {
    const f = fieldsWith([]);
    expect(f.label).toBe("गले मिलते हुए लोग");
    expect(f.keyword.split("|")).toEqual(["अलविदा", "धन्यवाद", "दोस्ती"]);
    expect(f.alias).toBe("गले लगाना");
    expect(f.extAlias).toBe("झप्पी");
    expect(f.low).toBe("सहारा");
  });

  it("moves a keyword curated as low to the low field, before the validated low phrases", () => {
    const f = fieldsWith([{ hexcode: "1FAC2", locale: "hi", alias: "धन्यवाद", action: "low" }]);
    expect(f.keyword.split("|")).toEqual(["अलविदा", "दोस्ती"]);
    expect(f.low.split("|")).toEqual(["धन्यवाद", "सहारा"]);
  });

  it("drops a keyword curated as remove from every field", () => {
    const f = fieldsWith([{ hexcode: "1FAC2", locale: "*", alias: "Goodbye", action: "remove" }], "en");
    expect(f.keyword.split("|")).toEqual(["hello", "hug", "thanks"]);
    expect(Object.values(f).join("|").split("|")).not.toContain("goodbye");
  });

  it("applies only to its emoji and locale", () => {
    const f = fieldsWith([
      { hexcode: "1FAC2", locale: "ru", alias: "धन्यवाद", action: "remove" },
      { hexcode: "1F979", locale: "hi", alias: "धन्यवाद", action: "remove" },
    ]);
    expect(f.keyword.split("|")).toContain("धन्यवाद");
  });

  it("never curates the label, even when a keyword repeats it", () => {
    for (const action of ["remove", "low"] as const) {
      const f = fieldsWith([{ hexcode: "1FAC2", locale: "hi", alias: "गले मिलते हुए लोग", action }]);
      expect(f).toEqual(fieldsWith([]));
    }
  });
});

describe("unmatched curation entries", () => {
  const phrasesOf = (hexcode: string, locale: string) =>
    hexcode === hug.hexcode
      ? [...cldrKeywords(hug, locale), ...(locale === "hi" ? validated.alias : [])]
      : [];

  it("reports an entry that names no alias or keyword of its emoji, so the build can warn", () => {
    const unknown: Curation = { hexcode: "1FAC2", locale: "hi", alias: "शुक्रिया", action: "low" };
    const otherEmoji: Curation = { hexcode: "1F979", locale: "hi", alias: "धन्यवाद", action: "low" };
    expect(unmatchedEdits([unknown, otherEmoji], ["en", "hi"], phrasesOf)).toEqual([unknown, otherEmoji]);
  });

  it("accepts a keyword or an alias match, in any locale a '*' entry covers", () => {
    const curations: Curation[] = [
      { hexcode: "1FAC2", locale: "hi", alias: "धन्यवाद", action: "low" },
      { hexcode: "1FAC2", locale: "hi", alias: "झप्पी", action: "remove" },
      { hexcode: "1FAC2", locale: "*", alias: "HUG", action: "low" },
      { hexcode: "1FAC2", locale: "hi", phrase: "नया", action: "add" },
    ];
    expect(unmatchedEdits(curations, ["en", "hi"], phrasesOf)).toEqual([]);
  });
});
