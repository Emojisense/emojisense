/**
 * Proposal sources (culture/sources/*.json): what culture:propose drafts entries from.
 *   calendar.json  holidays and festivals per region and locale (fixed, computed or listed dates)
 *   events.json    big sports and cultural events, with neutral titles
 *   slang.json     meaning shifts: what people mean by an emoji now
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CultureWindow } from "emojisense";
import { CULTURE_DIR } from "../paths.ts";
import { addDays } from "./compile.ts";

export const SOURCES_DIR = join(CULTURE_DIR, "sources");

export interface DatedSource {
  id: string;
  /** Neutral name per locale; English is always present. */
  title: Record<string, string>;
  category: "religious" | "cultural" | "civic" | "awareness" | "sport";
  regions: string[];
  locales: string[];
  /** A yearly window, or one dated window per occurrence (lunar calendars, events). */
  dates: CultureWindow | CultureWindow[];
  /** How the dates were obtained: fixed, computed (and how), or listed from a named calendar. */
  basis: string;
  /** Neutral description for the model and the reviewer. */
  hint: string;
  /** Hexcodes an editor suggests; the model may choose others from the catalog. */
  emoji?: string[];
}

export interface SlangSource {
  id: string;
  /** The emoji whose meaning shifted. */
  emoji: string[];
  meaning: string;
  /** Phrases people type for it, per locale (not yet normalized). */
  phrases: Record<string, string[]>;
  regions: string[];
  note?: string;
}

export interface SourceFile<T> {
  format: "emojisense-culture-sources";
  kind: "calendar" | "events" | "slang";
  note: string;
  items: T[];
}

export function loadSources(dir = SOURCES_DIR): { dated: DatedSource[]; slang: SlangSource[] } {
  const dated: DatedSource[] = [];
  const slang: SlangSource[] = [];
  if (!existsSync(dir)) return { dated, slang };
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as SourceFile<DatedSource | SlangSource>;
    if (file.kind === "slang") slang.push(...(file.items as SlangSource[]));
    else dated.push(...(file.items as DatedSource[]));
  }
  return { dated, slang };
}

export interface Occurrence {
  /** The festival or event days. */
  from: string;
  to: string;
  /** Year of `from`; dated entries get it as an id suffix. */
  year: number;
  yearly: boolean;
}

/** Occurrences of a dated source whose days start within [from, from + days]. */
export function occurrencesBetween(source: DatedSource, from: string, days: number): Occurrence[] {
  const until = addDays(from, days);
  const windows = Array.isArray(source.dates) ? source.dates : [source.dates];
  const found: Occurrence[] = [];
  for (const window of windows) {
    if (window.recurs === "yearly") {
      for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year++) {
        const start = `${year}-${window.from}`;
        const end = `${window.to >= window.from ? year : year + 1}-${window.to}`;
        if (start >= from && start <= until) found.push({ from: start, to: end, year, yearly: true });
      }
    } else if (window.from >= from && window.from <= until) {
      found.push({ from: window.from, to: window.to, year: Number(window.from.slice(0, 4)), yearly: false });
    }
  }
  return found;
}
