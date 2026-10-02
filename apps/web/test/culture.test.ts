import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalize } from "emojisense";
import { afterEach, describe, expect, it } from "vitest";
import {
  appliesInRegion,
  applyCulture,
  buildCultureShowcase,
  type CultureEntry,
  isActiveOn,
  loadCultureEntries,
  matchesQuery,
  PREVIEW_ENTRIES,
  toGlyph,
  windowsOf,
} from "../src/lib/culture";

function entry(overrides: Partial<CultureEntry>): CultureEntry {
  return {
    id: "test",
    status: "approved",
    kind: "lasting",
    context: { en: "Test" },
    when: null,
    regions: ["*"],
    locales: ["*"],
    triggers: { en: ["goat"] },
    emoji: [{ hexcode: "26BD", weight: 0.5 }],
    source: "editorial",
    ...overrides,
  };
}

const byId = (id: string) => {
  const found = PREVIEW_ENTRIES.find((e) => e.id === id);
  if (!found) throw new Error(`missing preview entry ${id}`);
  return found;
};

describe("applyCulture", () => {
  it("keeps the canonical top answer first and adds culture right after it", () => {
    const ranked = applyCulture(["🐐", "🧔‍♀️", "🤹"], [byId("goat-football")]);
    expect(ranked.map((r) => r.emoji)).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹", "🧔‍♀️", "🤹"]);
    expect(ranked[0]?.source).toBe("canonical");
    expect(ranked.slice(1, 4).every((r) => r.source === "culture" && r.cultureId === "goat-football")).toBe(
      true,
    );
  });

  it("orders additions by weight and never repeats an emoji", () => {
    const heavy = entry({ id: "heavy", emoji: [{ hexcode: "1F3C0", weight: 0.9 }] });
    const ranked = applyCulture(["🐐", "⚽️"], [byId("goat-football"), heavy]);
    expect(ranked.map((r) => r.emoji)).toEqual(["🐐", "🏀", "⚽", "🇦🇷", "🇵🇹"]);
  });

  it("does not add the top answer again", () => {
    const same = entry({ emoji: [{ hexcode: "1F410", weight: 1 }] });
    expect(applyCulture(["🐐"], [same]).map((r) => r.emoji)).toEqual(["🐐"]);
  });

  it("lets culture answer when the canonical list is empty", () => {
    expect(applyCulture([], [byId("skull-laughing")]).map((r) => r.emoji)).toEqual(["💀", "😭"]);
  });
});

describe("matching", () => {
  it("matches normalized triggers as whole words", () => {
    const skull = byId("skull-laughing");
    expect(matchesQuery(skull, "I'm DEAD!!")).toBe(true);
    expect(matchesQuery(skull, "lol im dead rn")).toBe(true);
    expect(matchesQuery(entry({}), "goated")).toBe(false);
  });

  it("uses the triggers of the search locale only", () => {
    const goat = byId("goat-football");
    expect(matchesQuery(goat, "el mejor de la historia", "es")).toBe(true);
    expect(matchesQuery(goat, "el mejor de la historia", "en")).toBe(false);
    expect(matchesQuery(entry({ locales: ["en"] }), "goat", "fr")).toBe(false);
  });

  it("applies regional entries only in their region", () => {
    const us = byId("goat-basketball-us");
    expect(appliesInRegion(us)).toBe(false);
    expect(appliesInRegion(us, "US")).toBe(true);
    expect(appliesInRegion(byId("goat-football"), "JP")).toBe(true);
  });
});

describe("windows", () => {
  it("repeats seasonal windows every year", () => {
    const halloween = byId("halloween");
    expect(isActiveOn(halloween, "2026-10-20")).toBe(true);
    expect(isActiveOn(halloween, "2027-10-31")).toBe(true);
    expect(isActiveOn(halloween, "2026-11-01")).toBe(false);
    expect(windowsOf(halloween, "2026-10-02").find((w) => w.to >= "2026-10-02")?.label).toBe("Oct 15 – 31");
  });

  it("handles seasonal windows across the new year", () => {
    const winter = entry({ kind: "seasonal", when: { from: "12-20", to: "01-06", recurs: "yearly" } });
    expect(isActiveOn(winter, "2027-01-03")).toBe(true);
    expect(isActiveOn(winter, "2026-12-24")).toBe(true);
    expect(isActiveOn(winter, "2026-11-30")).toBe(false);
  });

  it("keeps one-off events to their dates and labels other years", () => {
    const ramadan = byId("ramadan-2027");
    expect(isActiveOn(ramadan, "2027-02-20")).toBe(true);
    expect(isActiveOn(ramadan, "2028-02-20")).toBe(false);
    expect(windowsOf(ramadan, "2026-10-02")[0]?.label).toBe("Feb 8 – Mar 10, 2027");
    expect(windowsOf(byId("diwali-2026"), "2026-10-02")[0]?.label).toBe("Nov 6 – 11");
  });
});

describe("toGlyph", () => {
  it("builds flags and sequences, and adds VS16 to text-default code points", () => {
    expect(toGlyph("1F1E6-1F1F7")).toBe("🇦🇷");
    expect(toGlyph("26BD")).toBe("⚽");
    expect(toGlyph("2620")).toBe("☠️");
  });

  it("rejects malformed hexcodes", () => {
    expect(() => toGlyph("goat")).toThrow(/invalid hexcode/);
  });
});

describe("PREVIEW_ENTRIES", () => {
  it.each(PREVIEW_ENTRIES.map((e) => [e.id, e] as const))("%s follows the entry rules", (_id, e) => {
    expect(e.status).toBe("approved");
    expect(e.context.en?.length).toBeGreaterThan(0);
    for (const { hexcode, weight } of e.emoji) {
      expect(() => toGlyph(hexcode)).not.toThrow();
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
    for (const trigger of e.triggers.en ?? []) expect(normalize(trigger)).toBe(trigger);
    if (e.kind === "lasting") expect(e.when).toBeNull();
    if (e.kind === "event" && e.when) {
      const days = (Date.parse(e.when.to) - Date.parse(e.when.from)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(60);
    }
  });
});

describe("loadCultureEntries", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, value: unknown) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(value));
  };

  it("falls back to the preview entries when the data folder does not exist", () => {
    const loaded = loadCultureEntries(join(tmpdir(), "emojisense-no-culture-here"));
    expect(loaded.source).toBe("preview");
    expect(loaded.entries).toBe(PREVIEW_ENTRIES);
  });

  it("reads only approved entries from the data folder", () => {
    dir = mkdtempSync(join(tmpdir(), "emojisense-culture-"));
    write("a.json", entry({ id: "approved" }));
    write("b.json", entry({ id: "draft", status: "draft" }));
    const loaded = loadCultureEntries(dir);
    expect(loaded.source).toBe("data");
    expect(loaded.entries.map((e) => e.id)).toEqual(["approved"]);
  });

  it("keeps the preview while nothing is approved yet", () => {
    dir = mkdtempSync(join(tmpdir(), "emojisense-culture-"));
    write("a.json", entry({ status: "draft" }));
    expect(loadCultureEntries(dir).source).toBe("preview");
  });

  it("names the file that does not match the format", () => {
    dir = mkdtempSync(join(tmpdir(), "emojisense-culture-"));
    write("broken.json", { id: 1 });
    expect(() => loadCultureEntries(dir)).toThrow(/broken\.json/);
  });
});

describe("buildCultureShowcase", () => {
  const canonical: Record<string, string[]> = {
    "greatest of all time": ["🐐", "🧔‍♀️", "🤹"],
    "i'm dead": ["😵", "💀", "⚰️", "🤣"],
    celebrate: ["🥳", "🎉", "🥂"],
    "thank you": ["🙏", "😊"],
  };
  const search = (query: string) => canonical[query] ?? [];
  const showcase = (today: string) =>
    buildCultureShowcase({ entries: PREVIEW_ENTRIES, source: "preview" }, search, today);

  it("reads the same search differently by region", () => {
    const goat = showcase("2026-10-02").queries.find((q) => q.query === "greatest of all time");
    expect(goat?.dimension).toBe("where");
    expect(goat?.options.map((o) => o.id)).toEqual(["where:*", "where:US", "where:IN"]);
    const emoji = (id: string) => goat?.options.find((o) => o.id === id)?.result.ranked.map((r) => r.emoji);
    expect(emoji("where:*")).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹", "🧔‍♀️", "🤹"]);
    expect(emoji("where:US")?.slice(0, 2)).toEqual(["🐐", "🏀"]);
    expect(emoji("where:IN")?.slice(0, 2)).toEqual(["🐐", "🏏"]);
  });

  it("reads the same search differently by date, starting with today", () => {
    const celebrate = showcase("2026-10-02").queries.find((q) => q.query === "celebrate");
    expect(celebrate?.dimension).toBe("when");
    expect(celebrate?.options.map((o) => o.id)).toEqual([
      "today",
      "when:halloween",
      "when:diwali-2026",
      "when:ramadan-2027",
    ]);
    const added = (id: string) =>
      celebrate?.options
        .find((o) => o.id === id)
        ?.result.ranked.filter((r) => r.source === "culture")
        .map((r) => r.emoji);
    expect(added("today")).toEqual([]);
    expect(added("when:halloween")).toEqual(["🎃", "👻"]);
    expect(added("when:diwali-2026")).toEqual(["🪔", "🎆"]);
    expect(added("when:ramadan-2027")).toEqual(["🌙", "🕌"]);
  });

  it("explains every cultural emoji it adds", () => {
    for (const lens of showcase("2026-10-02").queries) {
      for (const option of lens.options) {
        const explained = new Set(option.result.notes.flatMap((n) => n.emoji));
        for (const r of option.result.ranked.filter((x) => x.source === "culture")) {
          expect(explained.has(r.emoji), `${lens.query} ${option.id} ${r.emoji}`).toBe(true);
        }
        for (const note of option.result.notes) expect(note.provenance).toMatch(/editor/);
      }
    }
  });

  it("lists featured moments that have not ended, soonest first", () => {
    expect(showcase("2026-10-02").calendar.map((c) => c.id)).toEqual([
      "oktoberfest-2026",
      "halloween",
      "dia-de-muertos",
      "diwali-2026",
      "ramadan-2027",
    ]);
    expect(showcase("2026-10-05").calendar[0]?.id).toBe("halloween");
  });

  it("leaves out searches the engine cannot answer", () => {
    const empty = buildCultureShowcase(
      { entries: PREVIEW_ENTRIES, source: "preview" },
      () => [],
      "2026-10-02",
    );
    expect(empty.queries).toEqual([]);
    expect(empty.highlights).toEqual([]);
  });
});
