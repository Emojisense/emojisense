import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { familyKey, loadPopularity, POPULARITY_FILE, popularityOf } from "../src/popularity.ts";

describe("popularity prior", () => {
  it("collapses gender, skin tone, person and presentation variants to one family", () => {
    expect(familyKey("1F926-200D-2642-FE0F")).toBe("1F926");
    expect(familyKey("1F44D-1F3FD")).toBe("1F44D");
    expect(familyKey("1F468-200D-1F680")).toBe("1F9D1-200D-1F680");
    expect(familyKey("2764-FE0F")).toBe("2764");
    expect(familyKey("1F468-200D-1F469-200D-1F466")).toBe("1F9D1-200D-1F469-200D-1F466");
  });

  it("gives each hexcode its rating's percentile, its family's when unrated, 0 when unknown", () => {
    const source = { ratings: { "1F602": 6, "1F926": 4, "1F926-200D-2640": 5, "1F525": 2 } };
    expect(popularityOf(["1F602", "1F926", "1F926-200D-2642-FE0F", "1F525", "1FAE0"], source)).toEqual([
      88, 38, 63, 13, 0,
    ]);
  });

  it("imports Emoji-SP with a license, a hash and plausible ratings", () => {
    const file = JSON.parse(readFileSync(POPULARITY_FILE, "utf8"));
    expect(file.license).toMatch(/CC BY 4\.0/);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { ratings } = loadPopularity();
    expect(Object.keys(ratings).length).toBeGreaterThan(1000);
    for (const value of Object.values(ratings)) expect(value >= 1 && value <= 7).toBe(true);
    // The most used emoji everywhere outranks a rarely used one.
    expect(ratings["1F602"]).toBeGreaterThan(ratings["1F3E3"] as number);
  });
});
