/**
 * Proposal source shapes (culture/sources/*.json) and their dated occurrences, without file
 * access: culture:propose (sources.ts reads the files) and the API Worker's nightly proposal job
 * (it bundles the files) share them.
 */
import type { CultureWhen, CultureWindow } from "emojisense";
import { LOCALE_CODES } from "../locales.ts";
import { addDays } from "./compile.ts";
import type { DraftCandidate } from "./draft.ts";
import { LIMITS } from "./validate.ts";

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

/** Dated and slang items of parsed source files, in file order. */
export function splitSources(files: readonly SourceFile<DatedSource | SlangSource>[]): {
  dated: DatedSource[];
  slang: SlangSource[];
} {
  const dated: DatedSource[] = [];
  const slang: SlangSource[] = [];
  for (const file of files) {
    if (file.kind === "slang") slang.push(...(file.items as SlangSource[]));
    else dated.push(...(file.items as DatedSource[]));
  }
  return { dated, slang };
}

/** A draft candidate from one occurrence of a holiday or event, with what the model is shown. */
export interface DatedCandidate extends DraftCandidate {
  /** The source item's id and how its dates were obtained (shown to the reviewer). */
  sourceId: string;
  basis: string;
  sourceKind: string;
  /** What the model and the reviewer see. */
  description: Record<string, unknown>;
  titles: Record<string, string>;
  hintEmoji: string[];
  searchTexts: string[];
  /** The festival or event days (without the lead). */
  occurrence: Occurrence;
}

/**
 * Candidates for the occurrences of a dated source that start within [from, from + days]. The id
 * is the source id for a yearly window and `<id>-<year>` for a dated one, so culture:propose and
 * the nightly job propose the same id for the same moment. The window opens `leadDays` early
 * (people talk about a moment before it); event windows stay within LIMITS.eventMaxDays.
 */
export function datedCandidates(
  source: DatedSource,
  from: string,
  days: number,
  leadDays: number,
): DatedCandidate[] {
  const monthDay = (day: string) => day.slice(5);
  return occurrencesBetween(source, from, days).map((occurrence) => {
    const span = (Date.parse(occurrence.to) - Date.parse(occurrence.from)) / 86_400_000 + 1;
    const lead = Math.max(0, Math.min(leadDays, LIMITS.eventMaxDays - span));
    const start = addDays(occurrence.from, -lead);
    const when: CultureWhen = occurrence.yearly
      ? { from: monthDay(start), to: monthDay(occurrence.to), recurs: "yearly" }
      : { from: start, to: occurrence.to };
    const locales = source.locales.includes("*") ? [...LOCALE_CODES] : source.locales;
    return {
      id: occurrence.yearly ? source.id : `${source.id}-${occurrence.year}`,
      kind: occurrence.yearly ? "seasonal" : "event",
      when,
      regions: source.regions,
      locales,
      featured: true,
      source: "calendar",
      sourceId: source.id,
      basis: source.basis,
      sourceKind: source.category === "sport" ? "sports event" : `${source.category} calendar day`,
      description: {
        title: source.title,
        days: `${occurrence.from} to ${occurrence.to}`,
        hint: source.hint,
        regions: source.regions,
      },
      titles: source.title,
      hintEmoji: source.emoji ?? [],
      searchTexts: [source.title.en ?? "", source.hint],
      occurrence,
    };
  });
}
