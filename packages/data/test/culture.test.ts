import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Culture, matchCulture, relevantNow } from "emojisense";
import { describe, expect, it } from "vitest";
import { buildCultureFiles, CULTURE_GZIP_BUDGET } from "../src/culture/build-files.ts";
import { loadCatalog } from "../src/culture/catalog.ts";
import { addDays, CULTURE_DAYS, compileCulture, featuredOn } from "../src/culture/compile.ts";
import { findExcluded, loadExclusions, parseExclusions } from "../src/culture/exclusions.ts";
import { loadRecords } from "../src/culture/records.ts";
import { type DatedSource, loadSources, occurrencesBetween } from "../src/culture/sources.ts";
import type { CultureRecord } from "../src/culture/types.ts";
import { validateRecord, validateRecords, windowDays } from "../src/culture/validate.ts";

const catalog = new Map([
  ["1F410", "🐐"],
  ["26BD", "⚽"],
  ["1F1E6-1F1F7", "🇦🇷"],
  ["1F383", "🎃"],
  ["1F47B", "👻"],
]);
const exclusions = parseExclusions("[political]\nelection\nvote for\n[tragedy]\nearthquake\n地震\n");
const context = { catalog, exclusions };

const record = (overrides: Partial<CultureRecord> = {}): CultureRecord => ({
  id: "goat-football",
  status: "approved",
  kind: "lasting",
  context: { en: "Football's greatest-of-all-time debate", es: "El debate del mejor de la historia" },
  when: null,
  regions: ["*"],
  locales: ["en", "es"],
  triggers: { en: ["goat", "greatest of all time"], es: ["el mejor de la historia", "goat"] },
  emoji: [
    { hexcode: "1F410", weight: 0.7 },
    { hexcode: "26BD", weight: 0.6 },
  ],
  source: "editorial",
  createdBy: "claude",
  reviewedBy: "editor",
  createdAt: "2026-10-02",
  ...overrides,
});

const errors = (r: unknown) =>
  validateRecord(r, context)
    .filter((i) => i.level === "error")
    .map((i) => i.message);

describe("culture validator", () => {
  it("accepts a well-formed record", () => {
    expect(validateRecord(record(), { ...context, fileName: "goat-football.json" })).toEqual([]);
  });

  it("checks hexcodes against the catalog and weights against (0, 1]", () => {
    const bad = record({
      emoji: [
        { hexcode: "1F984", weight: 0.5 },
        { hexcode: "26BD", weight: 1.5 },
        { hexcode: "26bd", weight: 0.5 },
      ],
    });
    expect(errors(bad)).toEqual([
      "emoji 1F984 is not a base emoji of the catalog",
      "emoji 26BD: weight must be in (0, 1]",
      'emoji hexcode "26bd" must be uppercase Emojibase hexcode',
    ]);
  });

  it("requires normalized, short, unique triggers in targeted locales", () => {
    const bad = record({
      triggers: { en: ["Greatest of All Time!", "goat", "goat"], fr: ["le meilleur"] },
    });
    expect(errors(bad)).toEqual([
      'triggers.en "Greatest of All Time!" is not normalized (expected "greatest of all time")',
      'triggers.en "goat" is listed twice',
      "triggers.fr: the entry does not target fr",
    ]);
  });

  it("requires a neutral context in English and every targeted locale", () => {
    expect(errors(record({ context: { en: "Football's GOAT debate" } }))).toEqual([
      "context.es is missing or too short",
    ]);
    expect(errors(record({ context: { en: "Best debate ever!", es: "Fútbol ⚽" } }))).toEqual([
      "context.en is not neutral: no exclamation marks",
      "context.es contains an emoji (the emoji are in `emoji`)",
    ]);
    expect(errors(record({ context: { en: "The GREATEST debate", es: "El debate" } }))).toEqual([
      "context.en is not neutral: a word in capitals",
    ]);
  });

  it("rejects excluded phrases in triggers and context, and blocklisted words", () => {
    expect(errors(record({ triggers: { en: ["vote for goat"] } }))).toEqual([
      'triggers.en "vote for goat" contains an excluded phrase: "vote for" (political)',
    ]);
    expect(errors(record({ context: { en: "After the earthquake", es: "El debate" } }))[0]).toContain(
      "earthquake",
    );
    expect(findExcluded("东京地震了", exclusions, "zh")).toBe('"地震" (tragedy)');
    expect(findExcluded("a nazi joke", exclusions)).toBe("a blocked word (blocklist)");
    expect(findExcluded("selection day", exclusions)).toBeUndefined();
  });

  it("validates windows by kind", () => {
    const seasonal = (when: CultureRecord["when"]) => errors(record({ kind: "seasonal", when }));
    expect(seasonal({ from: "12-26", to: "01-02", recurs: "yearly" })).toEqual([]);
    expect(seasonal(null)[0]).toContain("needs one window");
    expect(seasonal({ from: "02-29", to: "03-05", recurs: "yearly" })[0]).toContain("no 02-29");
    expect(seasonal({ from: "06-01", to: "10-01", recurs: "yearly" })[0]).toContain("max 92");
    const event = (when: CultureRecord["when"]) => errors(record({ kind: "event", when }));
    expect(event({ from: "2027-06-24", to: "2027-07-25" })).toEqual([]);
    expect(event({ from: "2027-06-01", to: "2027-08-15" })[0]).toContain("max 60");
    expect(event({ from: "2027-07-25", to: "2027-06-24" })[0]).toContain("ends before it starts");
    expect(event({ from: "10-15", to: "10-31", recurs: "yearly" })[0]).toContain("not a yearly window");
    expect(errors(record({ when: { from: "2027-01-01", to: "2027-01-02" } }))).toEqual([
      "a lasting entry has `when: null`",
    ]);
    expect(windowDays("12-26", "01-02", true)).toBe(8);
  });

  it("checks targeting, status and provenance", () => {
    expect(errors(record({ regions: ["*", "US"], locales: ["xx"] }))).toEqual(
      expect.arrayContaining(['regions: "*" stands alone', 'unknown locale "xx"']),
    );
    expect(errors(record({ regions: ["ZZ"] }))).toEqual(['unknown region "ZZ"']);
    expect(errors(record({ reviewedBy: undefined }))).toEqual([
      "an approved entry names its reviewer (reviewedBy)",
    ]);
    expect(errors(record({ featured: true }))).toEqual(["only seasonal and event entries can be featured"]);
    expect(validateRecords([{ record: record() }, { record: record() }], context).at(-1)?.message).toBe(
      "id used 2 times",
    );
  });

  it("asks a regional sense for its scope and the canonical answers it may move down", () => {
    const regional = (overrides: Partial<CultureRecord>) =>
      errors(
        record({
          kind: "regional",
          regions: ["*"],
          exceptRegions: ["US", "CA"],
          emoji: [{ hexcode: "26BD", weight: 0.9 }],
          outranks: ["1F410"],
          ...overrides,
        }),
      );
    expect(regional({})).toEqual([]);
    expect(regional({ regions: ["GB", "IE"], exceptRegions: undefined })).toEqual([]);
    expect(regional({ exceptRegions: undefined })).toEqual([
      'a regional entry names its regions, or uses ["*"] with exceptRegions',
    ]);
    expect(regional({ regions: ["GB"] })).toEqual(['exceptRegions needs regions: ["*"]']);
    expect(regional({ exceptRegions: ["XX"] })).toEqual(['unknown region "XX" in exceptRegions']);
    expect(regional({ outranks: undefined })).toEqual([
      "a regional entry lists 1–3 canonical answers in outranks",
    ]);
    expect(regional({ outranks: ["26BD"] })).toEqual(["outranks 26BD is one of the entry's own emoji"]);
    expect(regional({ outranks: ["1F984"] })).toEqual(["outranks 1F984 is not a base emoji of the catalog"]);
    expect(regional({ when: { from: "10-15", to: "10-31", recurs: "yearly" } })).toEqual([
      "a regional entry has `when: null`",
    ]);
    expect(regional({ featured: true })).toEqual(["only seasonal and event entries can be featured"]);
    expect(errors(record({ outranks: ["1F410"] }))).toEqual(["only regional entries have outranks"]);
  });
});

describe("culture compiler", () => {
  const halloween = record({
    id: "halloween",
    kind: "seasonal",
    context: { en: "Halloween, 31 October", es: "Halloween, 31 de octubre" },
    when: { from: "10-15", to: "10-31", recurs: "yearly" },
    triggers: { en: ["halloween"], es: ["halloween", "noche de brujas"] },
    emoji: [
      { hexcode: "1F47B", weight: 0.5 },
      { hexcode: "1F383", weight: 0.9 },
    ],
    featured: true,
  });
  const draft = record({ id: "draft", status: "draft" });
  const options = { packVersion: "test", catalog };

  const event = (id: string, from: string, to: string, trigger = id) =>
    record({
      id,
      kind: "event",
      context: { en: `The ${trigger} event`, es: `El evento ${trigger}` },
      when: { from, to },
      triggers: { en: [trigger], es: [trigger] },
      emoji: [{ hexcode: "1F383", weight: 0.8 }],
      featured: true,
    });
  const newYear = record({
    id: "new-year",
    kind: "seasonal",
    context: { en: "New Year", es: "Año Nuevo" },
    when: { from: "12-26", to: "01-02", recurs: "yearly" },
    triggers: { en: ["new year"], es: ["ano nuevo"] },
    emoji: [{ hexcode: "1F47B", weight: 0.8 }],
    featured: true,
  });

  it("covers at least 12 months: every yearly entry and the events of that time", () => {
    expect(CULTURE_DAYS).toBe(366);
    const records = [
      record(),
      halloween,
      draft,
      event("ended", "2026-09-01", "2026-10-01"),
      event("last-day", "2026-09-20", "2026-10-02"),
      event("next-year", "2027-09-30", "2027-10-10"),
      event("too-late", "2027-10-04", "2027-10-10"),
    ];
    const file = compileCulture(records, "es", { ...options, from: "2026-10-02" });
    expect(file).toMatchObject({
      format: "emojisense-culture",
      formatVersion: 1,
      locale: "es",
      from: "2026-10-02",
      until: "2027-10-03",
    });
    expect(file.entries.map((e) => e.id)).toEqual(["last-day", "next-year", "halloween", "goat-football"]);
    // Built in spring, the file still holds Halloween: the client switches it on by its own day.
    const spring = compileCulture([halloween], "es", { ...options, from: "2027-03-01" });
    expect(spring.entries.map((e) => e.id)).toEqual(["halloween"]);
  });

  it("holds 12 months across a leap day", () => {
    expect(compileCulture([halloween], "es", { ...options, from: "2027-10-02" }).until).toBe("2028-10-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    const leap = event("leap", "2028-02-29", "2028-03-01");
    expect(compileCulture([leap], "es", { ...options, from: "2027-03-01" }).entries).toHaveLength(1);
  });

  it("writes no relevantNow list: a list for one day would be out of date before the next deploy", () => {
    const file = compileCulture([halloween, newYear], "es", { ...options, from: "2026-10-20" });
    expect(file.relevantNow).toEqual([]);
    expect(featuredOn(file, "2026-10-20")).toEqual(["halloween"]);
    expect(featuredOn(file, "2027-01-01")).toEqual(["new-year"]);
    expect(featuredOn(file, "2027-03-01")).toEqual([]);
  });

  it("keeps a shorter window on request", () => {
    const early = compileCulture([record(), halloween, draft], "es", {
      ...options,
      from: "2026-09-20",
      days: 14,
    });
    expect(early.until).toBe("2026-10-04");
    expect(early.entries.map((e) => e.id)).toEqual(["goat-football"]);
  });

  it("lets the consumer decide by date what is active (one build, a whole year)", () => {
    const diwali = event("diwali-2026", "2026-10-30", "2026-11-11", "diwali");
    const file = compileCulture([record(), halloween, newYear, diwali], "es", {
      ...options,
      from: "2026-10-02",
    });
    const active = (day: string) =>
      file.entries
        .filter((e) => matchCulture(file, e.triggers[0] ?? "", { day, prefix: false }).length > 0)
        .map((e) => e.id);
    const shelf = (day: string) => [...new Set(relevantNow(file, { day }).map((r) => r.cultureId))];
    const days = [
      "2026-10-02",
      "2026-10-14",
      "2026-10-15",
      "2026-10-31",
      "2026-11-01",
      "2026-11-11",
      "2026-11-12",
      "2026-12-31",
      "2027-01-02",
      "2027-01-03",
      "2027-10-15",
    ];
    expect(Object.fromEntries(days.map((day) => [day, [active(day), shelf(day)]]))).toEqual({
      "2026-10-02": [["goat-football"], []],
      "2026-10-14": [["goat-football"], []],
      "2026-10-15": [["halloween", "goat-football"], ["halloween"]],
      "2026-10-31": [
        ["diwali-2026", "halloween", "goat-football"],
        ["diwali-2026", "halloween"],
      ],
      "2026-11-01": [["diwali-2026", "goat-football"], ["diwali-2026"]],
      "2026-11-11": [["diwali-2026", "goat-football"], ["diwali-2026"]],
      "2026-11-12": [["goat-football"], []],
      "2026-12-31": [["new-year", "goat-football"], ["new-year"]],
      "2027-01-02": [["new-year", "goat-football"], ["new-year"]],
      "2027-01-03": [["goat-football"], []],
      "2027-10-15": [["halloween", "goat-football"], ["halloween"]],
    });
  });

  it("writes the locale's context and triggers, and emoji strongest first", () => {
    const [entry] = compileCulture([halloween], "es", { ...options, from: "2026-10-20" }).entries;
    expect(entry).toEqual({
      id: "halloween",
      kind: "seasonal",
      context: "Halloween, 31 de octubre",
      when: { from: "10-15", to: "10-31", recurs: "yearly" },
      regions: ["*"],
      triggers: ["halloween", "noche de brujas"],
      emoji: [
        ["🎃", "1F383", 0.9],
        ["👻", "1F47B", 0.5],
      ],
      featured: true,
    });
  });

  it("never copies English triggers into other locales", () => {
    const englishOnly = record({ triggers: { en: ["goat"] } });
    expect(compileCulture([englishOnly], "es", { ...options, from: "2026-10-02" }).entries).toEqual([]);
  });

  it("forces every entry active for the eval gate", () => {
    const compiled = compileCulture([halloween], "en", { ...options, from: "2026-05-01", forceActive: true });
    expect(compiled.entries[0]).toMatchObject({ when: null, regions: ["*"] });
  });

  it("keeps the scope and outranks of a regional sense, and never features it", () => {
    const regional = record({
      id: "football-soccer",
      kind: "regional",
      regions: ["*"],
      exceptRegions: ["US"],
      locales: ["en"],
      context: { en: "Outside North America, football means soccer" },
      triggers: { en: ["football"] },
      emoji: [{ hexcode: "26BD", weight: 0.9 }],
      outranks: ["1F410"],
      featured: true,
    });
    const [entry] = compileCulture([regional, record()], "en", { ...options, from: "2026-10-02" }).entries;
    expect(entry).toEqual({
      id: "football-soccer",
      kind: "regional",
      context: "Outside North America, football means soccer",
      when: null,
      regions: ["*"],
      exceptRegions: ["US"],
      triggers: ["football"],
      emoji: [["⚽", "26BD", 0.9]],
      outranks: ["1F410"],
    });
    const forced = compileCulture([regional], "en", { ...options, from: "2026-10-02", forceActive: true });
    expect(forced.entries[0]?.exceptRegions).toBeUndefined();
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
  });
});

describe("committed culture data", () => {
  const realCatalog = loadCatalog();

  it("entries all pass validation", () => {
    const loaded = loadRecords();
    const issues = validateRecords(loaded, { catalog: realCatalog, exclusions: loadExclusions() });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("build into small files that hold every yearly entry, without a relevantNow list", () => {
    const outDir = mkdtempSync(join(tmpdir(), "culture-"));
    try {
      const build = buildCultureFiles({ from: "2026-10-02", outDir });
      expect(build.until).toBe("2027-10-03");
      const records = loadRecords().map((l) => l.record);
      for (const [locale, summary] of Object.entries(build.locales)) {
        const file: Culture = JSON.parse(readFileSync(join(outDir, `culture.${locale}.json`), "utf8"));
        expect(file.relevantNow).toEqual([]);
        // Every entry that is not a dated event is in, whatever the build day.
        const always = compileCulture(records, locale, {
          packVersion: build.packVersion,
          from: "2026-10-02",
          catalog: realCatalog,
          forceActive: true,
        })
          .entries.filter((e) => e.kind !== "event")
          .map((e) => e.id);
        expect(file.entries.map((e) => e.id)).toEqual(expect.arrayContaining(always));
        expect(summary.gzipBytes, locale).toBeLessThanOrEqual(CULTURE_GZIP_BUDGET);
      }
      const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
      expect(index).toMatchObject({
        format: "emojisense-culture-index",
        from: "2026-10-02",
        until: "2027-10-03",
      });
      expect(index.locales.en).not.toHaveProperty("relevantNow");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("sources use catalog emoji, valid windows and English titles", () => {
    const { dated, slang } = loadSources();
    expect(dated.length).toBeGreaterThan(40);
    for (const source of dated) {
      expect(source.title.en, source.id).toBeTruthy();
      for (const hexcode of source.emoji ?? [])
        expect(realCatalog.has(hexcode), `${source.id} ${hexcode}`).toBe(true);
      for (const w of Array.isArray(source.dates) ? source.dates : [source.dates]) {
        const days = windowDays(w.from, w.to, w.recurs === "yearly");
        expect(days > 0 && days <= 60, `${source.id} ${w.from}..${w.to}`).toBe(true);
      }
    }
    for (const item of slang) {
      for (const hexcode of item.emoji) expect(realCatalog.has(hexcode), `${item.id} ${hexcode}`).toBe(true);
    }
  });

  it("lists every lunar-calendar festival for 2026 and 2027", () => {
    const { dated } = loadSources();
    for (const source of dated.filter((s) => Array.isArray(s.dates) && s.category !== "sport")) {
      const years = (source.dates as { from: string }[]).map((w) => w.from.slice(0, 4));
      expect(years, source.id).toEqual(["2026", "2027"]);
    }
  });
});

describe("source occurrences", () => {
  const source = (dates: DatedSource["dates"]): DatedSource => ({
    id: "x",
    title: { en: "X" },
    category: "cultural",
    regions: ["*"],
    locales: ["*"],
    dates,
    basis: "test",
    hint: "test",
  });

  it("finds yearly occurrences across the year end", () => {
    const newYear = source({ from: "12-31", to: "01-01", recurs: "yearly" });
    expect(occurrencesBetween(newYear, "2026-12-20", 30)).toEqual([
      { from: "2026-12-31", to: "2027-01-01", year: 2026, yearly: true },
    ]);
    expect(occurrencesBetween(newYear, "2027-01-02", 30)).toEqual([]);
  });

  it("finds dated occurrences that start in the range", () => {
    const diwali = source([
      { from: "2026-11-06", to: "2026-11-10" },
      { from: "2027-10-27", to: "2027-10-31" },
    ]);
    expect(occurrencesBetween(diwali, "2026-10-02", 60).map((o) => o.year)).toEqual([2026]);
    expect(occurrencesBetween(diwali, "2027-09-01", 60).map((o) => o.year)).toEqual([2027]);
  });
});
