import { describe, expect, it } from "vitest";
import { bootstrapQueries } from "../src/shards/bootstrap.ts";
import type { BaseEmoji } from "../src/types.ts";
import type { Validated } from "../src/validate.ts";

const base = (hexcode: string, label: string, trLabel: string, subgroup: string): BaseEmoji => ({
  hexcode,
  emoji: "",
  label,
  tags: [],
  shortcodes: [],
  group: "test",
  subgroup,
  order: 0,
  version: 1,
  skins: [],
  i18n: { tr: { label: trLabel, tags: [] } },
});

const emoji = [
  base("1F680", "rocket", "roket", "transport-air"),
  base("1F436", "dog", "köpek", "animal-mammal"),
];
const validated: Validated = {
  "1F680": {
    en: {
      desc: "Ship it, launch day, to the moon; fast growth or blasting off toward a goal.",
      alias: ["spaceship", "ship it", "to infinity and beyond"],
      typo: ["rocet"],
      low: ["growth mode"],
    },
    tr: { desc: "Canlıya aldık; hızlı büyüme ve lansman.", alias: ["canlıya aldık"], typo: [], low: [] },
  },
};

describe("bootstrap queries", () => {
  const rows = bootstrapQueries(emoji, validated, 5);
  const texts = (locale: string) => rows.filter((r) => r.locale === locale).map((r) => r.q);

  it("takes multi-word aliases, not single words or typos", () => {
    expect(texts("en")).toContain("ship it");
    expect(texts("en")).toContain("growth mode");
    expect(texts("en")).not.toContain("spaceship");
    expect(texts("en")).not.toContain("rocet");
    expect(texts("tr")).toContain("canlıya aldık");
  });

  it("cuts descriptions into short phrases", () => {
    expect(texts("en")).toEqual(expect.arrayContaining(["launch day", "to the moon", "fast growth"]));
    expect(texts("en")).toContain("blasting off toward a goal");
    expect(texts("en")).not.toContain("ship it launch day");
    expect(texts("tr")).toEqual(expect.arrayContaining(["canliya aldik", "hizli buyume"]));
  });

  it("adds mood templates and mood + animal phrases in both locales", () => {
    expect(texts("en")).toEqual(expect.arrayContaining(["feeling tired", "so sad", "sad dog"]));
    expect(texts("tr")).toEqual(expect.arrayContaining(["çok yorgun", "sevimli köpek"]));
  });

  it("gives every row a synthetic count at or above the threshold, strong aliases higher", () => {
    for (const row of rows) expect(row.n).toBeGreaterThanOrEqual(5);
    const ship = rows.find((r) => r.q === "ship it")?.n ?? 0;
    const growth = rows.find((r) => r.q === "growth mode")?.n ?? 0;
    expect(ship).toBeGreaterThan(growth);
  });

  it("builds the queries of any locale it is given, with templates for English and Turkish only", () => {
    const withSpanish: Validated = {
      "1F680": {
        ...validated["1F680"],
        es: { desc: "Lanzamiento del producto, hacia la luna.", alias: ["a la luna"], typo: [], low: [] },
      } as Validated[string],
    };
    const spanish = bootstrapQueries(emoji, withSpanish, 5, ["es"]);
    expect(spanish.every((r) => r.locale === "es")).toBe(true);
    expect(spanish.map((r) => r.q)).toEqual(
      expect.arrayContaining(["a la luna", "lanzamiento del producto", "hacia la luna"]),
    );
    expect(spanish.map((r) => r.q)).not.toContain("feeling tired");
  });

  it("cuts descriptions at the punctuation of other scripts too", () => {
    const withChinese: Validated = {
      "1F680": {
        ...validated["1F680"],
        zh: { desc: "火箭 发射，冲向 月球。", alias: [], typo: [], low: [] },
      } as Validated[string],
    };
    expect(bootstrapQueries(emoji, withChinese, 5, ["zh"]).map((r) => r.q)).toEqual(
      expect.arrayContaining(["火箭 发射", "冲向 月球"]),
    );
  });
});
