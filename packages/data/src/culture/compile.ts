/**
 * Approved records → one locale's culture file (core `Culture`, docs/PACK_FORMAT.md §9).
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

export interface CompileOptions {
  packVersion: string;
  /** First day the file covers, "YYYY-MM-DD". */
  from: string;
  /** Days after `from` whose seasonal and event entries are included. Default 14. */
  days?: number;
  /** hexcode → emoji. Emoji missing here are left out. */
  catalog: ReadonlyMap<string, string>;
  /** Default ["approved"]. culture:review previews drafts too. */
  statuses?: RecordStatus[];
  /** Ignore windows and regions: every entry active everywhere (the eval gate). */
  forceActive?: boolean;
}

const DAY_MS = 86_400_000;
const KIND_ORDER = { event: 0, seasonal: 1, lasting: 2 } as const;

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
  const { packVersion, from, days = 14, catalog, statuses = ["approved"], forceActive = false } = options;
  const until = addDays(from, days);
  const entries: CultureEntry[] = [];
  for (const record of records) {
    if (!statuses.includes(record.status) || !targetLocales(record).includes(locale)) continue;
    if (!forceActive && !activeBetween(record.when, from, until)) continue;
    const triggers = triggersFor(record, locale);
    const featured = record.featured === true && record.kind !== "lasting";
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
      triggers,
      emoji,
      ...(featured ? { featured } : {}),
    });
  }
  entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  const relevantNow = entries
    .filter((e) => e.featured && e.kind !== "lasting" && isActiveOn(e.when, from))
    .map((e) => e.id);
  return {
    format: CULTURE_FORMAT,
    formatVersion: CULTURE_FORMAT_VERSION,
    packVersion,
    locale,
    from,
    until,
    entries,
    relevantNow,
  };
}
