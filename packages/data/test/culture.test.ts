import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/culture/catalog.ts";
import { addDays, compileCulture } from "../src/culture/compile.ts";
import { findExcluded, loadExclusions, parseExclusions } from "../src/culture/exclusions.ts";
import { loadRecords } from "../src/culture/records.ts";
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

  it("keeps lasting entries and the seasonal ones active within the next 14 days", () => {
    const early = compileCulture([record(), halloween, draft], "es", { ...options, from: "2026-09-20" });
    expect(early.entries.map((e) => e.id)).toEqual(["goat-football"]);
    const soon = compileCulture([record(), halloween], "es", { ...options, from: "2026-10-02" });
    expect(soon).toMatchObject({ format: "emojisense-culture", locale: "es", until: "2026-10-16" });
    expect(soon.entries.map((e) => e.id)).toEqual(["halloween", "goat-football"]);
    expect(soon.relevantNow).toEqual([]);
    const now = compileCulture([halloween], "es", { ...options, from: "2026-10-20" });
    expect(now.relevantNow).toEqual(["halloween"]);
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

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
  });
});

describe("committed culture entries", () => {
  it("all pass validation", () => {
    const loaded = loadRecords();
    const issues = validateRecords(loaded, { catalog: loadCatalog(), exclusions: loadExclusions() });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
