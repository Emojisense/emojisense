/**
 * The culture layer on the landing page, prepared at build time.
 *
 * Entries come from the editorial data in packages/data/culture/entries/*.json (one file per
 * association, format in the culture-layer spec). Canonical results come from the real engine
 * (showcase.ts). Cultural emoji are merged with the culture layer's rule: they join right after
 * the canonical top answer and never push it down.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { answersFor } from "./showcase";

export type CultureKind = "lasting" | "seasonal" | "event";

/** Seasonal windows use "MM-DD" and recur yearly; event windows use "YYYY-MM-DD". Both inclusive. */
export interface CultureWhen {
  from: string;
  to: string;
  recurs?: "yearly";
}

export interface CultureEntry {
  id: string;
  status: "draft" | "approved" | "retired";
  kind: CultureKind;
  /** Why the emoji fits, per locale. */
  context: Record<string, string>;
  when: CultureWhen | null;
  /** ISO 3166 codes, or "*". */
  regions: string[];
  locales: string[];
  triggers: Record<string, string[]>;
  emoji: { hexcode: string; weight: number }[];
  featured?: boolean;
  source: "editorial" | "ai-proposed" | "calendar";
  createdBy?: string;
  reviewedBy?: string;
  createdAt?: string;
}

/**
 * Sample entries in the real format, used only while packages/data/culture/entries does not exist.
 * Replaced by the real, reviewed data when the culture layer lands on main; delete them then.
 */
export const PREVIEW_ENTRIES: CultureEntry[] = [
  {
    id: "goat-football",
    status: "approved",
    kind: "lasting",
    context: {
      en: "Football's GOAT debate",
      es: "El debate del mejor de la historia",
      pt: "O debate do melhor de todos",
    },
    when: null,
    regions: ["*"],
    locales: ["*"],
    triggers: {
      en: ["goat", "greatest of all time"],
      es: ["el mejor de la historia"],
      pt: ["o melhor de todos"],
    },
    emoji: [
      { hexcode: "26BD", weight: 0.6 },
      { hexcode: "1F1E6-1F1F7", weight: 0.45 },
      { hexcode: "1F1F5-1F1F9", weight: 0.45 },
    ],
    featured: false,
    source: "editorial",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "goat-basketball-us",
    status: "approved",
    kind: "lasting",
    context: { en: "Basketball's GOAT debate" },
    when: null,
    regions: ["US"],
    locales: ["en"],
    triggers: { en: ["goat", "greatest of all time"] },
    emoji: [{ hexcode: "1F3C0", weight: 0.7 }],
    featured: false,
    source: "editorial",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "goat-cricket-in",
    status: "approved",
    kind: "lasting",
    context: { en: "Cricket's GOAT debate" },
    when: null,
    regions: ["IN"],
    locales: ["en", "hi"],
    triggers: { en: ["goat", "greatest of all time"] },
    emoji: [{ hexcode: "1F3CF", weight: 0.7 }],
    featured: false,
    source: "editorial",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "skull-laughing",
    status: "approved",
    kind: "lasting",
    context: { en: "Slang for “I'm dying laughing”" },
    when: null,
    regions: ["*"],
    locales: ["en"],
    triggers: { en: ["im dead", "dying laughing", "lmao", "so funny", "hilarious", "crying laughing"] },
    emoji: [
      { hexcode: "1F480", weight: 0.85 },
      { hexcode: "1F62D", weight: 0.5 },
    ],
    featured: false,
    source: "editorial",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "thanks-bow-jp",
    status: "approved",
    kind: "lasting",
    context: { en: "In Japan, thanks often comes with a bow" },
    when: null,
    regions: ["JP"],
    locales: ["*"],
    triggers: { en: ["thank you", "thanks", "arigato"] },
    emoji: [{ hexcode: "1F647", weight: 0.6 }],
    featured: false,
    source: "editorial",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "oktoberfest-2026",
    status: "approved",
    kind: "event",
    context: { en: "Oktoberfest" },
    when: { from: "2026-09-19", to: "2026-10-04" },
    regions: ["DE", "AT"],
    locales: ["*"],
    triggers: { en: ["oktoberfest", "prost", "cheers"] },
    emoji: [
      { hexcode: "1F37B", weight: 0.6 },
      { hexcode: "1F968", weight: 0.5 },
    ],
    featured: true,
    source: "calendar",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "halloween",
    status: "approved",
    kind: "seasonal",
    context: { en: "Halloween", es: "Halloween", pt: "Halloween" },
    when: { from: "10-15", to: "10-31", recurs: "yearly" },
    regions: ["*"],
    locales: ["*"],
    triggers: { en: ["halloween", "spooky", "costume", "trick or treat", "celebrate", "party tonight"] },
    emoji: [
      { hexcode: "1F383", weight: 0.7 },
      { hexcode: "1F47B", weight: 0.5 },
    ],
    featured: true,
    source: "calendar",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "dia-de-muertos",
    status: "approved",
    kind: "seasonal",
    context: { en: "Día de Muertos", es: "Día de Muertos" },
    when: { from: "10-31", to: "11-02", recurs: "yearly" },
    regions: ["MX"],
    locales: ["*"],
    triggers: { en: ["day of the dead"], es: ["dia de muertos", "dia de los muertos", "ofrenda"] },
    emoji: [
      { hexcode: "1F480", weight: 0.7 },
      { hexcode: "1F33C", weight: 0.5 },
    ],
    featured: true,
    source: "calendar",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "diwali-2026",
    status: "approved",
    kind: "event",
    context: { en: "Diwali", hi: "दिवाली" },
    when: { from: "2026-11-06", to: "2026-11-11" },
    regions: ["*"],
    locales: ["*"],
    triggers: {
      en: ["diwali", "happy diwali", "festival of lights", "celebrate"],
      hi: ["दिवाली", "शुभ दीपावली"],
    },
    emoji: [
      { hexcode: "1FA94", weight: 0.7 },
      { hexcode: "1F386", weight: 0.45 },
    ],
    featured: true,
    source: "calendar",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "ramadan-2027",
    status: "approved",
    kind: "event",
    context: { en: "Ramadan and Eid", ar: "رمضان والعيد" },
    when: { from: "2027-02-08", to: "2027-03-10" },
    regions: ["*"],
    locales: ["*"],
    triggers: {
      en: ["ramadan", "ramadan kareem", "iftar", "suhoor", "eid", "eid mubarak", "celebrate"],
      ar: ["رمضان كريم", "عيد مبارك"],
    },
    emoji: [
      { hexcode: "1F319", weight: 0.7 },
      { hexcode: "1F54C", weight: 0.45 },
    ],
    featured: true,
    source: "calendar",
    createdBy: "ai+review",
    reviewedBy: "preview",
    createdAt: "2026-10-01T00:00:00Z",
  },
];

// --- Loading ---------------------------------------------------------------------------------

const ENTRIES_DIR = join(process.cwd(), "../../packages/data/culture/entries");

export interface LoadedCulture {
  entries: CultureEntry[];
  /** "preview" while the real data has not landed; the page marks itself with it. */
  source: "data" | "preview";
}

function isEntry(value: unknown): value is CultureEntry {
  const entry = value as Partial<CultureEntry> | null;
  return (
    typeof entry?.id === "string" &&
    typeof entry.context?.en === "string" &&
    typeof entry.triggers === "object" &&
    Array.isArray(entry.regions) &&
    Array.isArray(entry.emoji) &&
    entry.emoji.every((e) => typeof e?.hexcode === "string" && typeof e.weight === "number")
  );
}

/** Approved entries from the data folder, or {@link PREVIEW_ENTRIES} when there are none yet. */
export function loadCultureEntries(dir = ENTRIES_DIR): LoadedCulture {
  if (!existsSync(dir)) return { entries: PREVIEW_ENTRIES, source: "preview" };
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const value: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (!isEntry(value)) throw new Error(`Culture entry ${name} does not match the entry format.`);
      return value;
    })
    .filter((entry) => entry.status === "approved");
  return entries.length > 0 ? { entries, source: "data" } : { entries: PREVIEW_ENTRIES, source: "preview" };
}

// --- Rules (pure) ----------------------------------------------------------------------------

const HEXCODE = /^[0-9A-F]{4,6}(-[0-9A-F]{4,6})*$/i;

/** "1F1E6-1F1F7" → "🇦🇷". Single text-default code points get VS16 so they render as emoji. */
export function toGlyph(hexcode: string): string {
  if (!HEXCODE.test(hexcode)) throw new Error(`Culture entry has an invalid hexcode: "${hexcode}".`);
  const points = hexcode.split("-").map((part) => Number.parseInt(part, 16));
  const glyph = String.fromCodePoint(...points);
  return points.length === 1 && !/\p{Emoji_Presentation}/u.test(glyph) ? `${glyph}️` : glyph;
}

const glyphKey = (emoji: string) => emoji.replace(/️/g, "");

export function matchesQuery(entry: CultureEntry, query: string, locale = "en"): boolean {
  if (!entry.locales.includes("*") && !entry.locales.includes(locale)) return false;
  const q = ` ${normalize(query)} `;
  return (entry.triggers[locale] ?? []).some((trigger) => {
    const t = normalize(trigger);
    return t !== "" && q.includes(` ${t} `);
  });
}

/** Without a region, only entries for everywhere apply. */
export function appliesInRegion(entry: CultureEntry, region?: string): boolean {
  return entry.regions.includes("*") || (region !== undefined && entry.regions.includes(region));
}

export interface DateWindow {
  /** Inclusive, "YYYY-MM-DD". */
  from: string;
  to: string;
  /** "Oct 15 – 31"; one-off events outside the current year add it: "Feb 8 – Mar 10, 2027". */
  label: string;
}

const MONTH_DAY = /^\d{2}-\d{2}$/;
const dayFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

function rangeLabel(from: string, to: string, withYear: boolean): string {
  const [a, b] = [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)];
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const end = sameMonth ? String(b.getUTCDate()) : dayFormat.format(b);
  const range = from === to ? dayFormat.format(a) : `${dayFormat.format(a)} – ${end}`;
  return withYear ? `${range}, ${b.getUTCFullYear()}` : range;
}

/**
 * Concrete windows of a seasonal or event entry. Yearly windows are listed from the year before
 * `around` to two years after, so a page built today still knows next year's dates.
 */
export function windowsOf(entry: CultureEntry, around: string): DateWindow[] {
  const when = entry.when;
  if (entry.kind === "lasting" || !when) return [];
  if (!MONTH_DAY.test(when.from)) {
    const otherYear = when.to.slice(0, 4) !== around.slice(0, 4);
    return [{ from: when.from, to: when.to, label: rangeLabel(when.from, when.to, otherYear) }];
  }
  const year = Number(around.slice(0, 4));
  return [year - 1, year, year + 1, year + 2].map((y) => {
    const from = `${y}-${when.from}`;
    const to = `${when.to >= when.from ? y : y + 1}-${when.to}`;
    return { from, to, label: rangeLabel(from, to, false) };
  });
}

export function isActiveOn(entry: CultureEntry, day: string): boolean {
  if (entry.kind === "lasting") return true;
  return windowsOf(entry, day).some((w) => w.from <= day && day <= w.to);
}

export interface RankedEmoji {
  emoji: string;
  source: "canonical" | "culture";
  cultureId?: string;
}

/**
 * The culture layer's merge rule: the canonical top answer stays first, cultural emoji follow it
 * (heaviest first, no duplicates), then the rest of the canonical list.
 */
export function applyCulture(canonical: string[], entries: CultureEntry[], limit = 8): RankedEmoji[] {
  const [top, ...rest] = canonical;
  const seen = new Set(top === undefined ? [] : [glyphKey(top)]);
  const added: RankedEmoji[] = [];
  const candidates = entries
    .flatMap((entry) =>
      entry.emoji.map((e) => ({ emoji: toGlyph(e.hexcode), weight: e.weight, id: entry.id })),
    )
    .sort((a, b) => b.weight - a.weight);
  for (const { emoji, id } of candidates) {
    if (seen.has(glyphKey(emoji))) continue;
    seen.add(glyphKey(emoji));
    added.push({ emoji, source: "culture", cultureId: id });
  }
  const tail = rest
    .filter((e) => !seen.has(glyphKey(e)))
    .map((emoji): RankedEmoji => ({ emoji, source: "canonical" }));
  const head: RankedEmoji[] = top === undefined ? [] : [{ emoji: top, source: "canonical" }];
  return [...head, ...added, ...tail].slice(0, limit);
}

// --- Landing page model ----------------------------------------------------------------------

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function regionName(code: string): string {
  return code === "*" ? "Everywhere" : (regionNames.of(code) ?? code);
}

export function flagOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Why an entry's emoji are in the results, shown next to them. */
export interface CultureNote {
  id: string;
  context: string;
  emoji: string[];
  /** "Lasting · everywhere", "Seasonal · Oct 15 – 31". */
  scope: string;
  /** Who put it there, stated plainly. */
  provenance: string;
}

export interface LensResult {
  ranked: RankedEmoji[];
  notes: CultureNote[];
}

export interface LensOption {
  id: string;
  label: string;
  flag?: string;
  /** For "when" options: the windows in which this option is the real answer. */
  windows?: DateWindow[];
  result: LensResult;
}

export interface LensQuery {
  query: string;
  canonical: string[];
  /** Which context changes this query: a region, a date, or nothing (lasting everywhere). */
  dimension: "where" | "when" | null;
  /** For "when" the first option is "Today" and is resolved against the visitor's date. */
  options: LensOption[];
}

export interface CalendarItem {
  id: string;
  context: string;
  emoji: string[];
  where: string;
  windows: DateWindow[];
}

export interface CultureHighlight {
  query: string;
  top: string;
  added: string[];
  note: string;
}

export interface CultureShowcase {
  source: LoadedCulture["source"];
  /** Build day, "YYYY-MM-DD". The island moves it to the visitor's day. */
  today: string;
  queries: LensQuery[];
  calendar: CalendarItem[];
  highlights: CultureHighlight[];
}

/** Searches that show the idea best. Ones the data has no entry for are left out. */
const SHOWCASE_QUERIES = ["greatest of all time", "i'm dead", "celebrate", "thank you"];
const MAX_QUERIES = 4;
const MAX_REGIONS = 3;
const MAX_CALENDAR = 5;

function provenanceOf(entry: CultureEntry): string {
  if (entry.source === "calendar") return "From the calendar, approved by an editor";
  if (entry.createdBy?.includes("ai") || entry.source === "ai-proposed")
    return "Proposed by AI, approved by an editor";
  return "Added by an editor";
}

function scopeOf(entry: CultureEntry, day: string): string {
  const where = entry.regions.includes("*") ? "everywhere" : entry.regions.map(regionName).join(", ");
  if (entry.kind === "lasting") return `Lasting · ${where}`;
  const next = windowsOf(entry, day).find((w) => w.to >= day);
  const kind = entry.kind === "seasonal" ? "Seasonal" : "Event";
  return `${kind}${next ? ` · ${next.label}` : ""}`;
}

function resultFor(canonical: string[], entries: CultureEntry[], day: string): LensResult {
  const ranked = applyCulture(canonical, entries);
  const notes = entries.flatMap((entry): CultureNote[] => {
    const emoji = ranked.filter((r) => r.cultureId === entry.id).map((r) => r.emoji);
    if (emoji.length === 0) return [];
    const context = entry.context.en ?? "";
    return [{ id: entry.id, context, emoji, scope: scopeOf(entry, day), provenance: provenanceOf(entry) }];
  });
  return { ranked, notes };
}

function lensFor(query: string, canonical: string[], entries: CultureEntry[], today: string): LensQuery {
  const matching = entries.filter((e) => matchesQuery(e, query));
  const lasting = (region?: string) =>
    matching.filter((e) => e.kind === "lasting" && appliesInRegion(e, region));
  const timed = matching
    .filter((e) => e.kind !== "lasting" && appliesInRegion(e))
    .map((entry) => ({ entry, next: windowsOf(entry, today).find((w) => w.to >= today) }))
    .filter((t): t is { entry: CultureEntry; next: DateWindow } => t.next !== undefined)
    .sort((a, b) => a.next.from.localeCompare(b.next.from));

  if (timed.length > 0) {
    const seasons = timed.map(({ entry, next }): LensOption => {
      const active = matching.filter((e) => appliesInRegion(e) && isActiveOn(e, next.from));
      return {
        id: `when:${entry.id}`,
        label: entry.context.en ?? entry.id,
        windows: windowsOf(entry, today).filter((w) => w.to >= today),
        result: resultFor(canonical, active, today),
      };
    });
    const base: LensOption = { id: "today", label: "Today", result: resultFor(canonical, lasting(), today) };
    return { query, canonical, dimension: "when", options: [base, ...seasons] };
  }

  const regions = [...new Set(matching.flatMap((e) => e.regions).filter((r) => r !== "*"))].slice(
    0,
    MAX_REGIONS,
  );
  const everywhere: LensOption = {
    id: "where:*",
    label: "Everywhere",
    result: resultFor(canonical, lasting(), today),
  };
  if (regions.length === 0) return { query, canonical, dimension: null, options: [everywhere] };
  const local = regions.map(
    (region): LensOption => ({
      id: `where:${region}`,
      label: regionName(region),
      flag: flagOf(region),
      result: resultFor(canonical, lasting(region), today),
    }),
  );
  return { query, canonical, dimension: "where", options: [everywhere, ...local] };
}

const hasCulture = (option: LensOption) => option.result.ranked.some((r) => r.source === "culture");

export function buildCultureShowcase(
  loaded: LoadedCulture,
  search: (query: string) => string[],
  today: string,
): CultureShowcase {
  const { entries } = loaded;
  // Queries named in SHOWCASE_QUERIES first, then the first trigger of any other entry, so the
  // section stays full whatever the editors approve.
  const candidates = [
    ...SHOWCASE_QUERIES,
    ...entries.filter((e) => e.kind === "lasting").map((e) => e.triggers.en?.[0] ?? ""),
  ].filter((q, i, all) => q !== "" && all.indexOf(q) === i);
  const queries: LensQuery[] = [];
  for (const query of candidates) {
    if (queries.length >= MAX_QUERIES) break;
    const canonical = search(query);
    if (canonical.length === 0) continue;
    const lens = lensFor(query, canonical, entries, today);
    if (lens.options.some(hasCulture)) queries.push(lens);
  }

  const calendar = entries
    .filter((e) => e.featured === true && e.kind !== "lasting")
    .map(
      (entry): CalendarItem => ({
        id: entry.id,
        context: entry.context.en ?? entry.id,
        emoji: entry.emoji.slice(0, 2).map((e) => toGlyph(e.hexcode)),
        where: entry.regions.includes("*") ? "" : entry.regions.map(regionName).join(", "),
        windows: windowsOf(entry, today).filter((w) => w.to >= today),
      }),
    )
    .filter((item) => item.windows.length > 0)
    .sort((a, b) => (a.windows[0]?.from ?? "").localeCompare(b.windows[0]?.from ?? ""))
    .slice(0, MAX_CALENDAR);

  const highlights = queries.flatMap((lens): CultureHighlight[] => {
    const option = lens.options.find(hasCulture);
    const top = option?.result.ranked[0]?.emoji;
    if (!option || top === undefined) return [];
    const added = option.result.ranked.filter((r) => r.source === "culture").map((r) => r.emoji);
    const context = option.result.notes[0]?.context ?? "";
    const when = lens.dimension === "when" ? option.windows?.[0]?.label : undefined;
    return [
      { query: lens.query, top, added: added.slice(0, 3), note: when ? `${context} · ${when}` : context },
    ];
  });

  return { source: loaded.source, today, queries, calendar, highlights: highlights.slice(0, 3) };
}

let cached: CultureShowcase | undefined;

/** The landing page's culture section, computed once per build with the real engine. */
export function cultureShowcase(): CultureShowcase {
  cached ??= buildCultureShowcase(
    loadCultureEntries(),
    (query) => answersFor([query], "en", 8)[0]?.top ?? [],
    new Date().toISOString().slice(0, 10),
  );
  return cached;
}
