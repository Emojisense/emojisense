/**
 * Approved records → one locale's culture file (core `Culture`, docs/PACK_FORMAT.md §9). A file
 * covers at least 12 months with each entry's own window, so clients decide on their own day what
 * is active and nobody has to rebuild it daily.
 */
import {
  CULTURE_FORMAT,
  CULTURE_FORMAT_VERSION,
  type Culture,
  type CultureEntry,
  type CultureWhen,
  isActiveOn,
} from "emojisense";
import type { CultureRecord, RecordStatus } from "./types.ts";
import { targetLocales } from "./validate.ts";
import { ZONE_REGIONS } from "./zones.generated.ts";

export interface CompileOptions {
  packVersion: string;
  /** First day the file covers, "YYYY-MM-DD". */
  from: string;
  /** Days after `from` whose seasonal and event entries are included. Default {@link CULTURE_DAYS}. */
  days?: number;
  /** hexcode → emoji. Emoji missing here are left out. */
  catalog: ReadonlyMap<string, string>;
  /** Default ["approved"]. culture:review previews drafts too. */
  statuses?: RecordStatus[];
  /**
   * Ignore windows and regions: every entry active everywhere (the eval gate). A regional entry
   * still leads only when a search names a region, so without one it only adds.
   */
  forceActive?: boolean;
}

/**
 * Days a build covers after its first day: 366, so the files hold at least 12 months also across
 * a leap day. Every yearly entry is in them, and every event that is on within that time.
 */
export const CULTURE_DAYS = 366;

/**
 * Most gzip bytes per locale file (a unit test checks the committed entries; the API Worker checks
 * the files it publishes with live entries). A 12-month file was at most 2.7 KB gz on 2026-10-02;
 * the room is for new entries, not for a bigger format.
 */
export const CULTURE_GZIP_BUDGET = 6 * 1024;

const DAY_MS = 86_400_000;
/** File order of entries: events first, lasting last (then by id). */
export const KIND_ORDER = { event: 0, seasonal: 1, regional: 2, lasting: 3 } as const;

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Is `when` active on any day of [from, until]? */
export function activeBetween(when: CultureWhen, from: string, until: string): boolean {
  for (let day = from; day <= until; day = addDays(day, 1)) if (isActiveOn(when, day)) return true;
  return false;
}

/**
 * Triggers for one locale file: that locale's list only. English words that people of a culture
 * really type ("goat" in Spanish football chat) are written into that locale's list; they are
 * never copied from `triggers.en` (DECISIONS.md, culture layer).
 */
export function triggersFor(record: CultureRecord, locale: string): string[] {
  return record.triggers[locale] ?? [];
}

export function compileCulture(
  records: readonly CultureRecord[],
  locale: string,
  options: CompileOptions,
): Culture {
  const {
    packVersion,
    from,
    days = CULTURE_DAYS,
    catalog,
    statuses = ["approved"],
    forceActive = false,
  } = options;
  const until = addDays(from, days);
  const entries: CultureEntry[] = [];
  for (const record of records) {
    if (!statuses.includes(record.status) || !targetLocales(record).includes(locale)) continue;
    if (!forceActive && !activeBetween(record.when, from, until)) continue;
    const triggers = triggersFor(record, locale);
    const featured = record.featured === true && (record.kind === "seasonal" || record.kind === "event");
    if (triggers.length === 0 && !featured) continue;
    const emoji = record.emoji
      .filter((e) => catalog.has(e.hexcode))
      .sort((a, b) => b.weight - a.weight)
      .map((e): [string, string, number] => [catalog.get(e.hexcode) as string, e.hexcode, e.weight]);
    if (emoji.length === 0) continue;
    entries.push({
      id: record.id,
      kind: record.kind,
      context: record.context[locale] ?? record.context.en ?? "",
      when: forceActive ? null : record.when,
      regions: forceActive ? ["*"] : record.regions,
      ...(record.exceptRegions && !forceActive ? { exceptRegions: record.exceptRegions } : {}),
      triggers,
      emoji,
      ...(featured ? { featured } : {}),
      ...(record.kind === "regional" && record.outranks ? { outranks: record.outranks } : {}),
    });
  }
  entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  const zones = zonesFor(entries);
  return {
    format: CULTURE_FORMAT,
    formatVersion: CULTURE_FORMAT_VERSION,
    packVersion,
    locale,
    from,
    until,
    entries,
    // A list for one day would be out of date until the next deploy. Clients check the windows
    // (core `relevantNow`); a client that reads this list shows no shelf instead of an old one.
    relevantNow: [],
    ...(zones ? { zones } : {}),
  };
}

/**
 * The time zones of the regions that entries name (`regions`, `exceptRegions`), so a device whose
 * language has no region ("ja", "fr") can find one from its time zone. A zone of any other region
 * would change nothing, so the file leaves it out. Undefined when entries name no region.
 */
export function zonesFor(entries: readonly CultureEntry[]): Record<string, string> | undefined {
  const named = new Set(entries.flatMap((e) => [...e.regions, ...(e.exceptRegions ?? [])]));
  const zones = Object.entries(ZONE_REGIONS).filter(([, region]) => named.has(region));
  return zones.length > 0 ? Object.fromEntries(zones) : undefined;
}

/** Ids of the featured entries of a file that are active on `day` (build log, previews). */
export function featuredOn(culture: Culture, day: string): string[] {
  return culture.entries.filter((e) => e.featured && isActiveOn(e.when, day)).map((e) => e.id);
}
