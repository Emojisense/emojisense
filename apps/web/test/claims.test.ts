/**
 * The landing page states facts about search quality. Check them against the real data packs so
 * a data change cannot make the page lie. Skipped until `pnpm data:build` has produced the packs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine, type Pack, shouldUseSemantic } from "emojisense";
import { describe, expect, it } from "vitest";
import { PACK_VERSION } from "../src/config";
import fixtures from "../src/demos/meaning-fixtures.json";
import { MEANING_QUERIES } from "../src/demos/meaning-queries";
import en from "../src/i18n/en.json";
import { DEMO_LOCALES } from "../src/lib/engine-client";
import { cityBubbles, comparisons, languages, stats } from "../src/lib/showcase";
import { CITIES, landDots, MAP, MAP_HEIGHT, project } from "../src/lib/world";

const built = stats.emoji > 0;

describe.skipIf(!built)("landing page claims", () => {
  it("shows every comparison row, each one empty in a name search", () => {
    expect(comparisons).toHaveLength(6);
    for (const row of comparisons) expect(row.name, row.query).toEqual([]);
  });

  it.each([
    ["jurassic park", "🦖"],
    ["greatest of all time", "🐐"],
    ["hallowelen", "🎃"],
  ])("the hero lead is true: “%s” gives %s first", (query, emoji) => {
    expect(comparisons.find((c) => c.query === query)?.emojisense[0] ?? emoji).toBe(emoji);
  });

  it("answers “happy birthday” with a birthday emoji in most languages", () => {
    expect(languages.length).toBeGreaterThanOrEqual(8);
  });

  it("puts at least eight verified searches on the edge map, each in a known city", () => {
    expect(cityBubbles.length).toBeGreaterThanOrEqual(8);
    const known = new Set(CITIES.map(([name]) => name));
    for (const b of cityBubbles) expect(known.has(b.city), b.city).toBe(true);
  });

  it("names every map city in the title reel", () => {
    const named = new Set(Object.keys(en.edge.cities));
    for (const b of cityBubbles) expect(named.has(b.city), b.city).toBe(true);
  });
});

describe.skipIf(!built)("demo meaning queries", () => {
  const pack = (name: string) =>
    JSON.parse(
      readFileSync(
        join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION, `pack.${name}.json`),
        "utf8",
      ),
    ) as Pack;
  // What the demos settle on: every language, core packs first (fullEngine in lib/engine-client).
  const full = createEngine(
    (["", ".ext"] as const).flatMap((part) => DEMO_LOCALES.map((l) => pack(`${l}${part}`))),
  );
  const answers: Record<string, string[] | undefined> = fixtures.answers;

  // If the packs learn one of these phrases, the demo no longer shows meaning search: pick a new one.
  it.each(MEANING_QUERIES)("$demo: the dictionary alone does not answer “$query”", ({ query, target }) => {
    const alias = full.search(query, { locale: "en", limit: 6, prefix: false });
    expect(shouldUseSemantic(alias)).toBe(true);
    expect(alias.results[0]?.id).not.toBe(target);
  });

  it.each(MEANING_QUERIES)(
    "$demo: meaning search puts the demo's emoji in its top 3 for “$query”",
    ({ query, target }) => {
      const answer = answers[query];
      expect(answer, "no recorded answer: run `pnpm --filter @emojisense/web record:meaning`").toBeDefined();
      expect(answer?.slice(0, 3)).toContain(target);
    },
  );
});

describe("world map", () => {
  it("draws land as dots inside the map", () => {
    const dots = landDots().match(/M[\d.]+ [\d.]+/g) ?? [];
    expect(dots.length).toBeGreaterThan(1500);
    for (const dot of dots) {
      const [x, y] = dot.slice(1).split(" ").map(Number) as [number, number];
      expect(x).toBeLessThanOrEqual(MAP.width);
      expect(y).toBeLessThanOrEqual(MAP_HEIGHT);
    }
  });

  it("places every city on the map", () => {
    for (const [name, lon, lat] of CITIES) {
      const { x, y } = project(lon, lat);
      expect(x, name).toBeGreaterThan(0);
      expect(x, name).toBeLessThan(MAP.width);
      expect(y, name).toBeGreaterThan(0);
      expect(y, name).toBeLessThan(MAP_HEIGHT);
    }
  });
});
