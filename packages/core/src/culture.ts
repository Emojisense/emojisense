/**
 * Culture layer: editorial associations that add emoji next to the canonical answer
 * ("greatest of all time" keeps 🐐 first and also shows ⚽ 🇦🇷 🇵🇹). File format:
 * docs/PACK_FORMAT.md §9.
 */
import type { AliasEngine, SearchResult } from "./engine.js";
import { normalize } from "./normalize.js";

export const CULTURE_FORMAT = "emojisense-culture";
export const CULTURE_FORMAT_VERSION = 1;

/**
 * `regional`: a word whose main sense differs by region ("football" is ⚽ outside North America).
 * It is the only kind that may put its emoji first, and only under the rules of
 * {@link matchRegionalLead}. Everywhere else it adds after the top result like a lasting entry.
 */
export type CultureKind = "lasting" | "seasonal" | "event" | "regional";

/**
 * Inclusive days: "MM-DD" with `recurs: "yearly"` (may wrap the year end), else "YYYY-MM-DD".
 * A festival on a lunar calendar is one dated entry per year (e.g. `diwali-2026`).
 */
export interface CultureWindow {
  from: string;
  to: string;
  recurs?: "yearly";
}

/** `null` = always (lasting entries). */
export type CultureWhen = CultureWindow | null;

/** `[emoji, hexcode, weight]`, weight 0–1, strongest first. */
export type CultureEmoji = [emoji: string, hexcode: string, weight: number];

export interface CultureEntry {
  id: string;
  kind: CultureKind;
  /** Why these emoji fit, in the file's locale. Neutral, short. */
  context: string;
  when: CultureWhen;
  /** ISO 3166-1 alpha-2 codes, or `["*"]` for every region. */
  regions: string[];
  /** With `regions: ["*"]`: regions where the entry does not apply when the app names one. */
  exceptRegions?: string[];
  /** Normalized phrases (docs/PACK_FORMAT.md §3) that people of this locale type. */
  triggers: string[];
  emoji: CultureEmoji[];
  /** May appear on a "relevant now" shelf (seasonal and event entries only). */
  featured?: boolean;
  /**
   * Regional entries only: hexcodes of the canonical top answers this regional sense may move to
   * second place (the other region's reading of the same word, e.g. 🏈 for "football").
   */
  outranks?: string[];
}

/** One locale's culture file: `culture.<locale>.json`. */
export interface Culture {
  format: typeof CULTURE_FORMAT;
  formatVersion: number;
  packVersion: string;
  locale: string;
  /** Days the build covered (YYYY-MM-DD). Seasonal and event entries outside them are not in the file. */
  from: string;
  until: string;
  entries: CultureEntry[];
  /** Ids of the featured entries active on `from`, in shelf order (for clients without this SDK). */
  relevantNow: string[];
}

export interface CultureResult extends SearchResult {
  source: "culture";
  /** The reason, in the culture file's locale. */
  context: string;
  cultureId: string;
  /** The trigger that matched. */
  match: string;
  /** Lets alias and culture results be read alike (`AliasResult.field` names a pack field). */
  field: "culture";
  /** Display label from the engine; empty without one. */
  label: string;
}

export interface CultureScope {
  /**
   * ISO 3166-1 alpha-2 region, e.g. "BR". Without it, only entries for every region (`"*"`)
   * apply; regional entries need an explicit region.
   */
  region?: string;
  /** The moment to check windows against, as a local calendar day. Default: now. */
  now?: Date | number;
}

export interface MatchCultureOptions extends CultureScope {
  /** Let the last word complete a trigger while the user is typing. Default true. */
  prefix?: boolean;
  /** Most culture results to add. Default 5. */
  limit?: number;
}

export interface ApplyCultureOptions extends MatchCultureOptions {
  /** Length of the returned list. Default: canonical results + culture results. */
  limit?: number;
  /** Only add emoji this engine knows, with its glyph and label. */
  engine?: Pick<AliasEngine, "get">;
  /** Label locale (with `engine`). */
  locale?: string;
}

const MAX_CULTURE_RESULTS = 5;
/** A typed prefix completes a trigger only when it is this long and covers half of the trigger. */
const MIN_PREFIX_LENGTH = 3;

export function assertCulture(value: unknown): asserts value is Culture {
  const culture = value as Partial<Culture> | null;
  if (culture?.format !== CULTURE_FORMAT) throw new Error("emojisense: not an emojisense culture file");
  if (culture.formatVersion !== CULTURE_FORMAT_VERSION) {
    throw new Error(
      `emojisense: culture format v${culture.formatVersion} is not supported (expected v${CULTURE_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(culture.entries)) throw new Error("emojisense: culture file has no entries");
}

export interface LoadCultureOptions {
  /** Culture directory of a pack version, e.g. "https://api.emojisense.com/v1/culture/0.1.0". */
  baseUrl: string;
  locale: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** A BCP 47-style locale tag: "en", "pt", "zh-Hans", "pt-BR". Nothing that can change the URL path. */
const LOCALE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

/** Fetch one locale's culture file. It changes daily, so it is cached for an hour, not forever. */
export async function loadCulture(options: LoadCultureOptions): Promise<Culture> {
  if (!LOCALE_TAG.test(options.locale)) {
    throw new Error(`emojisense: "${options.locale}" is not a locale tag`);
  }
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const file = encodeURIComponent(`culture.${options.locale}.json`);
  const url = `${options.baseUrl.replace(/\/+$/, "")}/${file}`;
  const response = await doFetch(url, { signal: options.signal ?? null });
  if (!response.ok) {
    throw new Error(`emojisense: culture file for "${options.locale}" failed with HTTP ${response.status}`);
  }
  const culture: unknown = await response.json();
  assertCulture(culture);
  return culture;
}

const ISO_REGION = /^[A-Z]{2}$/;

/**
 * The ISO 3166-1 alpha-2 region of a BCP 47 locale tag: "pt-BR" → "BR", "zh-Hant-TW" → "TW".
 * Undefined when the tag has no such region ("en", "es-419") or is not a valid tag.
 */
export function regionOf(locale: string): string | undefined {
  try {
    const { region } = new Intl.Locale(locale);
    return region && ISO_REGION.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The region of the browser's language (`navigator.language`), the default region for culture
 * entries when an app gives none. It is read on the device and never sent anywhere.
 */
export function deviceRegion(): string | undefined {
  const language = globalThis.navigator?.language;
  return language ? regionOf(language) : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of `now` as "YYYY-MM-DD". */
export function localDay(now: Date | number = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Is a `when` active on `day` ("YYYY-MM-DD")? Yearly windows may wrap the year end (12-26 → 01-02). */
export function isActiveOn(when: CultureWhen, day: string): boolean {
  if (when === null) return true;
  const { from, to, recurs } = when;
  if (recurs !== "yearly") return from <= day && day <= to;
  const monthDay = day.slice(5);
  return from <= to ? from <= monthDay && monthDay <= to : monthDay >= from || monthDay <= to;
}

function inScope(entry: CultureEntry, region: string | undefined, day: string): boolean {
  const code = region?.toUpperCase();
  const listed = entry.regions.includes("*") || (code !== undefined && entry.regions.includes(code));
  const excepted = code !== undefined && (entry.exceptRegions?.includes(code) ?? false);
  return listed && !excepted && isActiveOn(entry.when, day);
}

/** How well a normalized query hits a trigger: 1 exact, < 1 a prefix being typed, 0 no match. */
function triggerQuality(trigger: string, query: string, typing: boolean): number {
  if (trigger === query) return 1;
  if (
    typing &&
    query.length >= MIN_PREFIX_LENGTH &&
    2 * query.length >= trigger.length &&
    trigger.startsWith(query)
  ) {
    return 0.6 + (0.4 * query.length) / trigger.length;
  }
  return 0;
}

/** Culture results for a query (active window and region only), strongest first. */
export function matchCulture(
  culture: Culture,
  query: string,
  options: MatchCultureOptions = {},
): CultureResult[] {
  const normalized = normalize(query);
  if (normalized === "") return [];
  const typing = (options.prefix ?? true) && !/\s$/.test(query);
  const day = localDay(options.now);
  const best = new Map<string, CultureResult>();
  for (const entry of culture.entries) {
    if (!inScope(entry, options.region, day)) continue;
    let quality = 0;
    let match = "";
    for (const trigger of entry.triggers) {
      const q = triggerQuality(trigger, normalized, typing);
      if (q > quality) [quality, match] = [q, trigger];
    }
    if (quality === 0) continue;
    for (const [emoji, id, weight] of entry.emoji) {
      const score = Math.round(weight * quality * 1000) / 1000;
      if (score <= (best.get(id)?.score ?? 0)) continue;
      best.set(id, {
        emoji,
        id,
        score,
        source: "culture",
        context: entry.context,
        cultureId: entry.id,
        match,
        field: "culture",
        label: "",
      });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, options.limit ?? MAX_CULTURE_RESULTS);
}

/**
 * The regional sense that leads the list, if any. All of these must hold:
 * - the entry is `regional` and the app named a region in its scope (no region, no lead);
 * - the normalized query equals one of its triggers (a prefix being typed is not enough);
 * - the canonical top result is one of its `outranks` hexcodes, the reading the editor saw.
 * The lead is the entry's strongest emoji. When several entries qualify, the strongest wins.
 */
export function matchRegionalLead(
  culture: Culture,
  query: string,
  canonicalTopId: string | undefined,
  options: CultureScope = {},
): CultureResult | undefined {
  if (!options.region || canonicalTopId === undefined) return undefined;
  const normalized = normalize(query);
  const day = localDay(options.now);
  let lead: CultureResult | undefined;
  for (const entry of culture.entries) {
    if (entry.kind !== "regional" || !entry.outranks?.includes(canonicalTopId)) continue;
    if (!entry.triggers.includes(normalized) || !inScope(entry, options.region, day)) continue;
    const strongest = entry.emoji.reduce<CultureEmoji | undefined>(
      (best, item) => (best === undefined || item[2] > best[2] ? item : best),
      undefined,
    );
    if (!strongest || strongest[1] === canonicalTopId || (lead && lead.score >= strongest[2])) continue;
    const [emoji, id, score] = strongest;
    lead = {
      emoji,
      id,
      score,
      source: "culture",
      context: entry.context,
      cultureId: entry.id,
      match: normalized,
      field: "culture",
      label: "",
    };
  }
  return lead;
}

/**
 * Add culture results right after the canonical top result. They never go above it, unless the
 * canonical list is empty or a regional `lead` ({@link matchRegionalLead}) is given: the lead goes
 * first and the canonical top result second. An emoji that is already lower in the list moves up
 * and carries its cultural context.
 */
export function insertCulture<T extends SearchResult>(
  results: readonly T[],
  matches: readonly CultureResult[],
  limit = results.length + matches.length + 1,
  lead?: CultureResult,
): (T | CultureResult)[] {
  const [top, ...rest] = results;
  if (!top) return matches.slice(0, limit);
  const head: (T | CultureResult)[] = lead && lead.id !== top.id ? [lead, top] : [top];
  const ids = new Set(head.map((r) => r.id));
  const added = matches.filter((m) => !ids.has(m.id));
  for (const m of added) ids.add(m.id);
  return [...head, ...added, ...rest.filter((r) => !ids.has(r.id))].slice(0, limit);
}

/** {@link matchCulture}, {@link matchRegionalLead} and {@link insertCulture} in one step. */
export function applyCulture<T extends SearchResult>(
  results: readonly T[],
  culture: Culture,
  query: string,
  options: ApplyCultureOptions = {},
): (T | CultureResult)[] {
  const { engine, locale, limit } = options;
  const withLabel = (match: CultureResult): CultureResult[] => {
    if (!engine) return [match];
    const entry = engine.get(match.id);
    if (!entry) return [];
    const label = entry.labels[locale ?? ""] ?? entry.labels.en ?? Object.values(entry.labels)[0] ?? "";
    return [{ ...match, emoji: entry.emoji, label }];
  };
  const matches = matchCulture(culture, query, { ...options, limit: MAX_CULTURE_RESULTS }).flatMap(withLabel);
  const lead = matchRegionalLead(culture, query, results[0]?.id, options);
  return insertCulture(results, matches, limit, lead && withLabel(lead)[0]);
}

export interface RelevantEmoji {
  emoji: string;
  hexcode: string;
  context: string;
  cultureId: string;
}

export interface RelevantNowOptions extends CultureScope {
  /** Pick the file of this locale when several are given. */
  locale?: string;
  /** Default 8. */
  limit?: number;
}

/**
 * Emoji for an optional "relevant now" shelf: featured seasonal and event entries that are active
 * today, one emoji per entry in turn (so two festivals share the shelf), in file order.
 */
export function relevantNow(
  culture: Culture | readonly Culture[],
  options: RelevantNowOptions = {},
): RelevantEmoji[] {
  const files: readonly Culture[] = Array.isArray(culture) ? culture : [culture as Culture];
  const file = options.locale ? files.find((c) => c.locale === options.locale) : files[0];
  if (!file) return [];
  const limit = options.limit ?? 8;
  const day = localDay(options.now);
  const entries = file.entries.filter(
    (e) =>
      e.featured === true && (e.kind === "seasonal" || e.kind === "event") && inScope(e, options.region, day),
  );
  const shelf: RelevantEmoji[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...entries.map((e) => e.emoji.length));
  for (let i = 0; i < depth && shelf.length < limit; i++) {
    for (const entry of entries) {
      const item = entry.emoji[i];
      if (!item || seen.has(item[1])) continue;
      seen.add(item[1]);
      shelf.push({ emoji: item[0], hexcode: item[1], context: entry.context, cultureId: entry.id });
      if (shelf.length === limit) break;
    }
  }
  return shelf;
}
