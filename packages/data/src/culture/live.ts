/**
 * Live entries (culture Phase 2): entries an editor approved in the dashboard, stored in D1 until
 * they are exported to culture/entries. The API Worker merges them into the deployed culture files
 * and publishes the result to R2, so an approval goes live without a deploy. No file access.
 */
import type { Culture, CultureEntry } from "emojisense";
import { compileCulture, KIND_ORDER } from "./compile.ts";
import type { CultureRecord } from "./types.ts";
import { targetLocales } from "./validate.ts";

const DAY_MS = 86_400_000;

export interface LiveMerge {
  culture: Culture;
  /** Live entry ids added to this locale's file. */
  added: string[];
  /** Live entry ids the file already has: the git entry wins (it was exported and deployed). */
  shadowed: string[];
}

/**
 * One deployed culture file plus the approved live entries for its locale, over the same days
 * and with the same file order. An id in both keeps the deployed (git) entry.
 */
export function mergeLiveEntries(
  file: Culture,
  live: readonly CultureRecord[],
  catalog: ReadonlyMap<string, string>,
): LiveMerge {
  const days = Math.round((Date.parse(file.until) - Date.parse(file.from)) / DAY_MS);
  const compiled = compileCulture(live, file.locale, {
    packVersion: file.packVersion,
    from: file.from,
    days,
    catalog,
  });
  const deployed = new Set(file.entries.map((e) => e.id));
  const added: CultureEntry[] = [];
  const shadowed: string[] = [];
  for (const entry of compiled.entries) {
    if (deployed.has(entry.id)) shadowed.push(entry.id);
    else added.push(entry);
  }
  const entries = [...file.entries, ...added].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
  return { culture: { ...file, entries }, added: added.map((e) => e.id), shadowed };
}

/** Which entry owns a trigger, per locale: proposals never repeat a trigger that is taken. */
export class TriggerIndex {
  private readonly owners = new Map<string, Map<string, string>>();

  /** Every trigger of a compiled culture file. */
  addCulture(culture: Culture): this {
    for (const entry of culture.entries)
      for (const t of entry.triggers) this.add(culture.locale, t, entry.id);
    return this;
  }

  /** Every trigger of a record, in each locale it targets. */
  addRecord(record: CultureRecord): this {
    for (const locale of targetLocales(record))
      for (const t of record.triggers[locale] ?? []) this.add(locale, t, record.id);
    return this;
  }

  add(locale: string, trigger: string, id: string): void {
    let byTrigger = this.owners.get(locale);
    if (!byTrigger) {
      byTrigger = new Map();
      this.owners.set(locale, byTrigger);
    }
    if (!byTrigger.has(trigger)) byTrigger.set(trigger, id);
  }

  /** The entry that already uses `trigger` in `locale`, if any. */
  owner(locale: string, trigger: string): string | undefined {
    return this.owners.get(locale)?.get(trigger);
  }
}

/**
 * The record without the triggers another entry already owns. Returns the dropped triggers too,
 * so a caller can say why a proposal lost them.
 */
export function withoutTakenTriggers(
  record: CultureRecord,
  taken: TriggerIndex,
): { record: CultureRecord; dropped: { locale: string; trigger: string; owner: string }[] } {
  const dropped: { locale: string; trigger: string; owner: string }[] = [];
  const triggers: Record<string, string[]> = {};
  for (const [locale, list] of Object.entries(record.triggers)) {
    const kept = list.filter((trigger) => {
      const owner = taken.owner(locale, trigger);
      if (owner && owner !== record.id) dropped.push({ locale, trigger, owner });
      return !owner || owner === record.id;
    });
    if (kept.length > 0) triggers[locale] = kept;
  }
  return { record: { ...record, triggers }, dropped };
}
