import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCulture,
  type Culture,
  type CultureEntry,
  deviceRegion,
  insertCulture,
  isActiveOn,
  loadCulture,
  localDay,
  matchCulture,
  matchRegionalLead,
  regionOf,
  relevantNow,
  scopeDay,
} from "../src/culture.js";
import { createEngine, type SearchResult } from "../src/engine.js";
import type { Pack, PackRow } from "../src/pack.js";
import { createSearchSession, type SessionState } from "../src/session.js";
import { en, row as fixtureRow } from "./fixture.js";

const row = (emoji: string, hexcode: string, label: string, keyword = ""): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  keyword,
  "",
  "",
  "",
];

const pack: Pack = {
  ...en,
  emoji: [
    ...en.emoji,
    row("⚽", "26BD", "soccer ball", "football"),
    row("🇦🇷", "1F1E6-1F1F7", "flag: Argentina"),
    row("🇵🇹", "1F1F5-1F1F9", "flag: Portugal"),
    row("👻", "1F47B", "ghost"),
    row("🙇", "1F647", "person bowing", "apology|bow"),
    fixtureRow("🏈", "1F3C8", "american football", { shortcode: "football" }),
  ],
};

const entry = (overrides: Partial<CultureEntry> & Pick<CultureEntry, "id">): CultureEntry => ({
  kind: "lasting",
  context: "Context",
  when: null,
  regions: ["*"],
  triggers: [],
  emoji: [],
  ...overrides,
});

const goat = entry({
  id: "goat-football",
  context: "Football's greatest-of-all-time debate",
  triggers: ["goat", "greatest of all time"],
  emoji: [
    ["🐐", "1F410", 0.7],
    ["⚽", "26BD", 0.6],
    ["🇦🇷", "1F1E6-1F1F7", 0.45],
    ["🇵🇹", "1F1F5-1F1F9", 0.45],
  ],
});
const halloween = entry({
  id: "halloween",
  kind: "seasonal",
  context: "Halloween, 31 October",
  when: { from: "10-15", to: "10-31", recurs: "yearly" },
  triggers: ["halloween", "spooky season"],
  emoji: [
    ["🎃", "1F383", 0.9],
    ["👻", "1F47B", 0.8],
  ],
  featured: true,
});
const bowJapan = entry({
  id: "thanks-bow-jp",
  context: "Thanks and apologies with a bow, as in Japan",
  regions: ["JP"],
  triggers: ["thank you"],
  emoji: [["🙇", "1F647", 0.7]],
});
const newYear = entry({
  id: "new-year",
  kind: "seasonal",
  context: "New Year",
  when: { from: "12-26", to: "01-02", recurs: "yearly" },
  triggers: ["new year"],
  emoji: [
    ["🎆", "1F386", 0.8],
    ["🥂", "1F942", 0.7],
  ],
  featured: true,
});

const culture = (entries: CultureEntry[], locale = "en"): Culture => ({
  format: "emojisense-culture",
  formatVersion: 1,
  packVersion: "test",
  locale,
  from: "2026-10-02",
  until: "2026-10-16",
  entries,
  relevantNow: [],
});

const OCT_20 = new Date(2026, 9, 20, 12);
const ids = (results: readonly SearchResult[]) => results.map((r) => r.emoji);

describe("windows", () => {
  it("treats lasting entries as always active", () => {
    expect(isActiveOn(null, "2026-01-01")).toBe(true);
  });

  it("checks dated windows inclusively", () => {
    const when = { from: "2027-01-07", to: "2027-02-05" };
    expect(isActiveOn(when, "2027-01-06")).toBe(false);
    expect(isActiveOn(when, "2027-01-07")).toBe(true);
    expect(isActiveOn(when, "2027-02-05")).toBe(true);
    expect(isActiveOn(when, "2027-02-06")).toBe(false);
  });

  it("repeats yearly windows every year", () => {
    const when = { from: "10-15", to: "10-31", recurs: "yearly" as const };
    expect(isActiveOn(when, "2026-10-31")).toBe(true);
    expect(isActiveOn(when, "2031-10-15")).toBe(true);
    expect(isActiveOn(when, "2026-11-01")).toBe(false);
  });

  it("wraps yearly windows across the year end", () => {
    const when = { from: "12-26", to: "01-02", recurs: "yearly" as const };
    expect(isActiveOn(when, "2026-12-25")).toBe(false);
    expect(isActiveOn(when, "2026-12-26")).toBe(true);
    expect(isActiveOn(when, "2026-12-31")).toBe(true);
    expect(isActiveOn(when, "2027-01-01")).toBe(true);
    expect(isActiveOn(when, "2027-01-02")).toBe(true);
    expect(isActiveOn(when, "2027-01-03")).toBe(false);
    expect(isActiveOn(when, "2027-06-15")).toBe(false);
  });

  it("handles a dated window that crosses the year end", () => {
    const when = { from: "2027-12-24", to: "2028-01-01" };
    expect(isActiveOn(when, "2027-12-31")).toBe(true);
    expect(isActiveOn(when, "2028-01-01")).toBe(true);
    expect(isActiveOn(when, "2026-12-31")).toBe(false);
  });

  it("uses the local calendar day", () => {
    expect(localDay(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(localDay(new Date(2027, 0, 1, 0, 1))).toBe("2027-01-01");
  });

  it("handles leap days in yearly and dated windows", () => {
    expect(localDay(new Date(2028, 1, 29, 12))).toBe("2028-02-29");
    const aroundMarch = { from: "02-25", to: "03-03", recurs: "yearly" as const };
    expect(isActiveOn(aroundMarch, "2028-02-29")).toBe(true);
    expect(isActiveOn(aroundMarch, "2027-02-28")).toBe(true);
    expect(isActiveOn(aroundMarch, "2027-03-01")).toBe(true);
    const toFebruary28 = { from: "02-20", to: "02-28", recurs: "yearly" as const };
    expect(isActiveOn(toFebruary28, "2028-02-28")).toBe(true);
    expect(isActiveOn(toFebruary28, "2028-02-29")).toBe(false);
    const fromMarch = { from: "03-01", to: "03-08", recurs: "yearly" as const };
    expect(isActiveOn(fromMarch, "2028-02-29")).toBe(false);
    expect(isActiveOn(fromMarch, "2028-03-01")).toBe(true);
    const leapEvent = { from: "2028-02-28", to: "2028-03-01" };
    expect(isActiveOn(leapEvent, "2028-02-29")).toBe(true);
    expect(isActiveOn(leapEvent, "2028-03-02")).toBe(false);
  });

  it("checks an explicit day before now, and only a YYYY-MM-DD day", () => {
    expect(scopeDay({ now: OCT_20 })).toBe("2026-10-20");
    expect(scopeDay({ now: OCT_20, day: "2026-11-01" })).toBe("2026-11-01");
    expect(() => scopeDay({ day: "2026-11-1" })).toThrow("YYYY-MM-DD");
    const file = culture([halloween]);
    expect(matchCulture(file, "halloween", { now: OCT_20, day: "2026-11-01" })).toEqual([]);
    expect(matchCulture(file, "halloween", { now: new Date(2026, 4, 1), day: "2026-10-31" })).toHaveLength(2);
  });
});

describe("one culture file for twelve months", () => {
  const diwali = entry({
    id: "diwali-2026",
    kind: "event",
    context: "Diwali 2026",
    when: { from: "2026-10-30", to: "2026-11-11" },
    triggers: ["diwali"],
    emoji: [["🪔", "1FA94", 0.9]],
    featured: true,
  });
  /** Built on 2026-10-02 for 366 days: every yearly entry, events of the next 12 months, no snapshot. */
  const yearFile: Culture = {
    ...culture([diwali, halloween, newYear, goat]),
    from: "2026-10-02",
    until: "2027-10-03",
  };
  const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour);
  const on = (now: Date) =>
    yearFile.entries
      .filter((e) => matchCulture(yearFile, e.triggers[0] ?? "", { now, prefix: false }).length > 0)
      .map((e) => e.id);
  const shelf = (now: Date) => [...new Set(relevantNow(yearFile, { now }).map((r) => r.cultureId))];

  it("switches a seasonal entry on the day it starts, with the same file", () => {
    expect(on(at(2026, 10, 14))).toEqual(["goat-football"]);
    expect(on(at(2026, 10, 15))).toEqual(["halloween", "goat-football"]);
    expect(shelf(at(2026, 10, 14))).toEqual([]);
    expect(shelf(at(2026, 10, 15))).toEqual(["halloween"]);
    expect(on(at(2026, 11, 1))).toEqual(["diwali-2026", "goat-football"]);
  });

  it("follows the device's local day, not the hour", () => {
    expect(on(at(2026, 10, 14, 23))).not.toContain("halloween");
    expect(on(new Date(2026, 9, 15, 0, 1))).toContain("halloween");
  });

  it("drops an event the day after it ends", () => {
    expect(on(at(2026, 11, 11))).toContain("diwali-2026");
    expect(shelf(at(2026, 11, 11))).toEqual(["diwali-2026"]);
    expect(on(at(2026, 11, 12))).not.toContain("diwali-2026");
    expect(shelf(at(2026, 11, 12))).toEqual([]);
  });

  it("crosses the year end and starts the next season again", () => {
    expect(on(at(2026, 12, 25))).toEqual(["goat-football"]);
    expect(on(new Date(2026, 11, 31, 23, 59))).toEqual(["new-year", "goat-football"]);
    expect(on(at(2027, 1, 2))).toEqual(["new-year", "goat-football"]);
    expect(on(at(2027, 1, 3))).toEqual(["goat-football"]);
    expect(on(at(2027, 10, 15))).toEqual(["halloween", "goat-football"]);
  });

  it("follows the day in a long-lived session", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const states: SessionState[] = [];
      const session = createSearchSession({
        engine: createEngine(pack).withCulture(yearFile),
        onChange: (s) => states.push(s),
      });
      vi.setSystemTime(new Date(2026, 9, 14, 23, 59));
      session.update("halloween");
      vi.setSystemTime(new Date(2026, 9, 15, 0, 1));
      session.update("halloween");
      expect(states.map((s) => s.results.some((r) => r.source === "culture"))).toEqual([false, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays a format v1 file, so released SDKs load it", async () => {
    expect(() => assertCulture(yearFile)).not.toThrow();
    const fetch = async () => new Response(JSON.stringify(yearFile));
    const loaded = await loadCulture({ baseUrl: "https://x.test/v1/culture/0.1.0", locale: "en", fetch });
    expect(relevantNow(loaded, { now: at(2026, 11, 5) }).map((r) => r.cultureId)).toEqual(["diwali-2026"]);
  });

  it("checks the windows of a file built the old way and ignores its relevantNow list", () => {
    const oldStyle: Culture = { ...culture([halloween]), from: "2026-10-20", until: "2026-11-03" };
    oldStyle.relevantNow = ["halloween"];
    expect(relevantNow(oldStyle, { now: at(2026, 10, 20) })).toHaveLength(2);
    expect(relevantNow(oldStyle, { now: at(2026, 11, 5) })).toEqual([]);
  });
});

describe("matchCulture", () => {
  it("matches exact triggers on the normalized query", () => {
    const results = matchCulture(culture([goat]), "  Greatest of ALL time! ");
    expect(ids(results)).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹"]);
    expect(results[0]).toMatchObject({
      source: "culture",
      cultureId: "goat-football",
      context: "Football's greatest-of-all-time debate",
      match: "greatest of all time",
      score: 0.7,
    });
  });

  it("completes a trigger while typing, but not from short or tiny prefixes", () => {
    expect(ids(matchCulture(culture([halloween]), "hallo", { now: OCT_20 }))).toEqual(["🎃", "👻"]);
    expect(matchCulture(culture([halloween]), "hallo", { now: OCT_20 })[0]?.score).toBeLessThan(0.9);
    expect(matchCulture(culture([halloween]), "hal", { now: OCT_20 })).toEqual([]);
    expect(matchCulture(culture([goat]), "go")).toEqual([]);
    expect(matchCulture(culture([halloween]), "hallo ", { now: OCT_20 })).toEqual([]);
    expect(matchCulture(culture([halloween]), "hallo", { now: OCT_20, prefix: false })).toEqual([]);
  });

  it("applies seasonal entries only inside their window", () => {
    expect(matchCulture(culture([halloween]), "halloween", { now: new Date(2026, 9, 1) })).toEqual([]);
    expect(matchCulture(culture([halloween]), "halloween", { now: OCT_20 })).toHaveLength(2);
    expect(matchCulture(culture([newYear]), "new year", { now: new Date(2027, 0, 1, 10) })).toHaveLength(2);
  });

  it("applies regional entries only with a matching region", () => {
    const file = culture([bowJapan]);
    expect(matchCulture(file, "thank you")).toEqual([]);
    expect(matchCulture(file, "thank you", { region: "US" })).toEqual([]);
    expect(ids(matchCulture(file, "thank you", { region: "jp" }))).toEqual(["🙇"]);
  });

  it("keeps the strongest entry per emoji and caps the count", () => {
    const lmao = entry({ id: "a", triggers: ["goat"], emoji: [["⚽", "26BD", 0.9]] });
    const results = matchCulture(culture([goat, lmao]), "goat", { limit: 2 });
    expect(results.map((r) => [r.emoji, r.cultureId])).toEqual([
      ["⚽", "a"],
      ["🐐", "goat-football"],
    ]);
  });
});

describe("insertCulture", () => {
  const canonical: SearchResult[] = [
    { emoji: "🐐", id: "1F410", score: 1, source: "alias" },
    { emoji: "♑", id: "2651", score: 0.89, source: "alias" },
    { emoji: "⚽", id: "26BD", score: 0.5, source: "alias" },
  ];
  const matches = matchCulture(culture([goat]), "goat");

  it("adds culture results right after the canonical top result, never above it", () => {
    const merged = insertCulture(canonical, matches);
    expect(ids(merged)).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹", "♑"]);
    expect(merged[0]?.source).toBe("alias");
    expect(merged[1]).toMatchObject({ source: "culture", context: goat.context });
  });

  it("puts culture results first only when the canonical list is empty", () => {
    expect(ids(insertCulture([], matches))).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹"]);
  });

  it("cuts the merged list to the limit", () => {
    expect(insertCulture(canonical, matches, 3)).toHaveLength(3);
  });
});

describe("regional senses", () => {
  const footballSoccer = entry({
    id: "football-soccer",
    kind: "regional",
    context: "Outside North America, football means soccer",
    regions: ["*"],
    exceptRegions: ["US", "CA"],
    triggers: ["football"],
    emoji: [["⚽", "26BD", 0.9]],
    outranks: ["1F3C8"],
  });
  const pantsUk = entry({
    id: "pants-underwear",
    kind: "regional",
    context: "In Britain, pants are underwear",
    regions: ["GB"],
    triggers: ["pants"],
    emoji: [["👻", "1F47B", 0.8]],
    outranks: ["1F410"],
  });
  const engine = createEngine(pack).withCulture(culture([footballSoccer, pantsUk, goat]));
  const top2 = (query: string, region?: string) =>
    ids(engine.search(query, { prefix: false, ...(region ? { region } : {}) }).results.slice(0, 2));

  it("keeps the canonical answer first without a region", () => {
    expect(ids(engine.search("football", { culture: false }).results.slice(0, 1))).toEqual(["🏈"]);
    expect(top2("football")).toEqual(["🏈", "⚽"]);
  });

  it("leads with the regional sense in its regions, and keeps the canonical answer second", () => {
    const results = engine.search("football", { region: "gb" }).results;
    expect(ids(results.slice(0, 2))).toEqual(["⚽", "🏈"]);
    expect(results[0]).toMatchObject({
      source: "culture",
      cultureId: "football-soccer",
      context: "Outside North America, football means soccer",
      label: "soccer ball",
    });
    expect(ids(results).filter((e) => e === "⚽")).toHaveLength(1);
  });

  it("changes nothing in the regions it excludes", () => {
    expect(top2("football", "US")).toEqual(["🏈", "⚽"]);
    expect(top2("football", "CA")[0]).toBe("🏈");
  });

  it("needs the whole trigger, not a prefix being typed", () => {
    expect(engine.search("footba", { region: "GB" }).results[0]?.emoji).toBe("🏈");
  });

  it("leads only over the canonical answers it names", () => {
    // pants-underwear names 🐐 as the reading it may move down; "pants" has no such answer here.
    expect(matchRegionalLead(culture([pantsUk]), "pants", "1F456", { region: "GB" })).toBeUndefined();
    expect(matchRegionalLead(culture([pantsUk]), "pants", "1F410", { region: "GB" })?.emoji).toBe("👻");
    expect(matchRegionalLead(culture([pantsUk]), "pants", "1F410", { region: "IE" })).toBeUndefined();
    expect(matchRegionalLead(culture([pantsUk]), "pants", "1F410")).toBeUndefined();
  });

  it("never leads for other kinds, even in their region", () => {
    expect(matchRegionalLead(culture([bowJapan]), "thank you", "1F44D", { region: "JP" })).toBeUndefined();
  });

  it("is off with culture: false", () => {
    expect(ids(engine.search("football", { region: "GB", culture: false }).results)[0]).toBe("🏈");
  });

  it("keeps the canonical answer within a short limit", () => {
    expect(ids(engine.search("football", { region: "GB", limit: 2 }).results)).toEqual(["⚽", "🏈"]);
  });

  it("follows the session region", () => {
    const states: SessionState[] = [];
    const session = createSearchSession({ engine, region: "DE", onChange: (s) => states.push(s) });
    session.update("football");
    expect(ids(states[0]?.results ?? []).slice(0, 2)).toEqual(["⚽", "🏈"]);
  });
});

describe("engine with culture", () => {
  const file = culture([
    goat,
    halloween,
    entry({ id: "x", triggers: ["goat"], emoji: [["🦄", "1F984", 1]] }),
  ]);
  const engine = createEngine(pack, { culture: file });

  it("adds context after the canonical top result", () => {
    const { results, confidence } = engine.search("goat");
    expect(ids(results)).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹"]);
    expect(results[1]).toMatchObject({ source: "culture", label: "soccer ball", cultureId: "goat-football" });
    expect(confidence).toBe(engine.search("goat", { culture: false }).confidence);
  });

  it("drops culture emoji the packs do not have", () => {
    expect(ids(engine.search("goat").results)).not.toContain("🦄");
  });

  it("opts out with culture: false", () => {
    expect(ids(engine.search("goat", { culture: false }).results)).toEqual(["🐐"]);
  });

  it("shares the index with withCulture", () => {
    const plain = engine.withCulture(undefined);
    expect(plain.culture).toBeUndefined();
    expect(plain.entries).toBe(engine.entries);
    expect(ids(plain.search("goat").results)).toEqual(["🐐"]);
    expect(ids(plain.withCulture(file).search("goat").results)).toHaveLength(4);
  });

  it("respects the search limit", () => {
    expect(engine.search("goat", { limit: 2 }).results).toHaveLength(2);
  });

  it("follows the window of seasonal entries", () => {
    expect(ids(engine.search("halloween", { now: OCT_20 }).results)).toEqual(["🎃", "👻"]);
    expect(engine.search("halloween", { now: new Date(2026, 5, 1) }).results[1]?.source).not.toBe("culture");
  });
});

describe("session with culture", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const semanticFirst = {
    search: async () => ({
      results: [
        { emoji: "🇵🇹", id: "1F1F5-1F1F9", score: 0.9, source: "semantic" as const },
        { emoji: "🐐", id: "1F410", score: 0.8, source: "semantic" as const },
      ],
      packVersion: "test",
      cached: false,
    }),
  };

  it("applies culture after fusion, so the canonical top result stays first", async () => {
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(pack).withCulture(culture([goat])),
      semantic: semanticFirst,
      shouldUseSemantic: () => true,
      debounceMs: 10,
      onChange: (s) => states.push(s),
    });
    session.update("greatest of all time");
    expect(ids(states[0]?.results ?? [])).toEqual(["🐐", "⚽", "🇦🇷", "🇵🇹"]);
    expect(states[0]?.alias.results.every((r) => r.source === "alias")).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    const fused = states.at(-1);
    expect(fused?.status).toBe("fused");
    expect(fused?.results[0]?.emoji).toBe("🐐");
    expect(fused?.results.slice(1, 4).map((r) => r.source)).toEqual(["culture", "culture", "culture"]);
  });

  it("turns culture off with culture: false", () => {
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(pack, { culture: culture([goat]) }),
      culture: false,
      onChange: (s) => states.push(s),
    });
    session.update("goat");
    expect(ids(states[0]?.results ?? [])).toEqual(["🐐"]);
  });

  it("passes the region to regional entries", () => {
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(pack),
      culture: culture([bowJapan]),
      region: "JP",
      onChange: (s) => states.push(s),
    });
    session.update("thank you");
    expect(ids(states[0]?.results ?? [])).toEqual(["🙇"]);
  });
});

describe("relevantNow", () => {
  const files = [
    culture([
      goat,
      halloween,
      entry({
        ...newYear,
        id: "dia",
        when: halloween.when,
        emoji: [
          ["🎃", "1F383", 1],
          ["💀", "1F480", 0.9],
        ],
      }),
    ]),
    culture([halloween], "es"),
  ];

  it("lists featured seasonal entries active now, one emoji per entry in turn", () => {
    expect(relevantNow(files, { now: OCT_20 }).map((r) => [r.emoji, r.cultureId])).toEqual([
      ["🎃", "halloween"],
      ["👻", "halloween"],
      ["💀", "dia"],
    ]);
  });

  it("is empty outside every window and never lists lasting entries", () => {
    expect(relevantNow(files, { now: new Date(2026, 4, 1) })).toEqual([]);
  });

  it("picks the file of the locale and honours limit and region", () => {
    expect(relevantNow(files, { locale: "es", now: OCT_20, limit: 1 })).toHaveLength(1);
    expect(relevantNow(files, { locale: "fr", now: OCT_20 })).toEqual([]);
    const regional = culture([{ ...halloween, regions: ["US"] }]);
    expect(relevantNow(regional, { now: OCT_20 })).toEqual([]);
    expect(relevantNow(regional, { now: OCT_20, region: "us" })).toHaveLength(2);
  });
});

describe("loadCulture", () => {
  it("fetches culture.<locale>.json from the base URL", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(culture([]))));
    const loaded = await loadCulture({ baseUrl: "https://x.test/v1/culture/0.1.0/", locale: "es", fetch });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://x.test/v1/culture/0.1.0/culture.es.json");
    expect(loaded.entries).toEqual([]);
  });

  it("rejects HTTP errors and other files", async () => {
    await expect(
      loadCulture({
        baseUrl: "https://x.test",
        locale: "en",
        fetch: async () => new Response("", { status: 404 }),
      }),
    ).rejects.toThrow("HTTP 404");
    await expect(
      loadCulture({
        baseUrl: "https://x.test",
        locale: "en",
        fetch: async () => new Response(JSON.stringify(en)),
      }),
    ).rejects.toThrow("not an emojisense culture file");
  });

  it("refuses locales that are not plain locale tags, before any request", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(culture([]))));
    for (const locale of ["../../v1/pack/0.1.0/pack.en", "en/../x", "en?x=1", "en#", "EN", "", "e"]) {
      await expect(loadCulture({ baseUrl: "https://x.test", locale, fetch })).rejects.toThrow(
        "is not a locale tag",
      );
    }
    expect(fetch).not.toHaveBeenCalled();
    await loadCulture({ baseUrl: "https://x.test", locale: "pt-BR", fetch });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://x.test/culture.pt-BR.json");
  });
});

describe("regionOf and deviceRegion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the two-letter region subtag of a locale tag", () => {
    expect(regionOf("pt-BR")).toBe("BR");
    expect(regionOf("zh-Hant-TW")).toBe("TW");
    expect(regionOf("en-us")).toBe("US");
    expect(regionOf("de-CH-1996")).toBe("CH");
    expect(regionOf("en-GB-u-ca-gregory")).toBe("GB");
  });

  it("gives no region without a two-letter region subtag", () => {
    for (const tag of ["en", "zh-Hans", "es-419", "", "not a tag"])
      expect(regionOf(tag), tag).toBeUndefined();
  });

  it("derives the region from navigator.language", () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(deviceRegion()).toBe("BR");
    vi.stubGlobal("navigator", { language: "fr" });
    expect(deviceRegion()).toBeUndefined();
    vi.stubGlobal("navigator", undefined);
    expect(deviceRegion()).toBeUndefined();
  });
});
