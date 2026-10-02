/**
 * The landing page states facts about search quality. Check them against the real data pack so
 * a data change cannot make the page lie. Skipped until `pnpm data:build` has produced the packs.
 */
import { existsSync, readFileSync } from "node:fs";
import { createEngine, type Pack, ROW_INDEX } from "emojisense";
import { describe, expect, it } from "vitest";
import { HERO_EXAMPLES, HERO_QUERY, SEARCH_CLAIMS } from "../src/content/landing";

const dataRoot = new URL("../../../packages/data/", import.meta.url);
const { packVersion } = JSON.parse(readFileSync(new URL("pack.config.json", dataRoot), "utf8")) as {
  packVersion: string;
};
const packDir = new URL(`dist/packs/${packVersion}/`, dataRoot);
const built = existsSync(new URL("pack.en.ext.json", packDir));

function load(file: string): Pack {
  return JSON.parse(readFileSync(new URL(file, packDir), "utf8")) as Pack;
}

/** The label and keyword substring filter most pickers ship (the same baseline as apps/demo). */
function nameSearch(pack: Pack, query: string): string[] {
  const q = query.toLowerCase().trim();
  return pack.emoji
    .filter(
      (row) =>
        row[ROW_INDEX.label].toLowerCase().includes(q) ||
        row[ROW_INDEX.keyword].split("|").some((tag) => tag !== "" && tag.includes(q)),
    )
    .map((row) => row[ROW_INDEX.emoji]);
}

describe.skipIf(!built)("landing page claims", () => {
  const en = built ? [load("pack.en.json"), load("pack.en.ext.json")] : [];
  const tr = built ? [load("pack.tr.json"), load("pack.tr.ext.json")] : [];
  // The hooks load core packs first and extension packs when idle; claims use the full set.
  const engines = built
    ? { en: createEngine(en), tr: createEngine([en[0] as Pack, tr[0] as Pack, en[1] as Pack, tr[1] as Pack]) }
    : undefined;

  it.each(SEARCH_CLAIMS)("“$query” gives the claimed emoji first, on device", (claim) => {
    const engine = engines?.[claim.locale];
    const top = engine?.search(claim.query, { limit: claim.top.length, locale: claim.locale }).results;
    expect(top?.map((r) => r.id)).toEqual(claim.top.map((t) => t.id));
  });

  it.each(SEARCH_CLAIMS)("name search finds nothing for “$query”", (claim) => {
    const pack = claim.locale === "tr" ? tr[0] : en[0];
    expect(nameSearch(pack as Pack, claim.query)).toEqual([]);
  });

  it("finds 🦖 for the hero query in the top two", () => {
    const ids = engines?.en.search(HERO_QUERY, { limit: 2 }).results.map((r) => r.id);
    expect(ids).toContain("1F996");
  });

  it("has an on-device answer for every hero example", () => {
    for (const example of HERO_EXAMPLES) {
      expect(engines?.en.search(example.query, { limit: 1 }).results, example.query).toHaveLength(1);
    }
  });

  it("has more than 80,000 aliases, as the layers section says", () => {
    const aliases = [...en, ...tr].reduce(
      (sum, pack) =>
        sum + pack.emoji.reduce((n, row) => n + row[ROW_INDEX.alias].split("|").filter(Boolean).length, 0),
      0,
    );
    expect(aliases).toBeGreaterThan(80_000);
  });
});
