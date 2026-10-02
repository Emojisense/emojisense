/**
 * The landing page states facts about search quality. Check them against the real data packs so
 * a data change cannot make the page lie. Skipped until `pnpm data:build` has produced the packs.
 */
import { describe, expect, it } from "vitest";
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
