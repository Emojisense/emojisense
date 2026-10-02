/**
 * Live entries back into git (culture Phase 2): the dashboard's export, or the rows of D1
 * `culture_entries_live`, written as culture/entries/<id>.json so git stays the long-term record.
 * Each entry is validated like culture:check before it is written.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENTRIES_DIR, formatRecord, writeRecord } from "./records.ts";
import type { CultureRecord } from "./types.ts";
import { type ValidationContext, validateRecord } from "./validate.ts";

/** The dashboard's export (`CultureLiveExport` in @emojisense/platform). */
export interface LiveExport {
  format: "emojisense-culture-live-export";
  formatVersion: 1;
  exportedAt: number;
  entries: CultureRecord[];
}

export interface ImportResult {
  written: string[];
  /** Same content as the file in git already. */
  unchanged: string[];
  /** A different entry with this id is in git; pass `force` to replace it. */
  conflicts: string[];
  invalid: { id: string; errors: string[] }[];
}

export function parseLiveExport(text: string): LiveExport {
  const value = JSON.parse(text) as Partial<LiveExport>;
  if (
    value.format !== "emojisense-culture-live-export" ||
    value.formatVersion !== 1 ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("not an emojisense culture live export (format emojisense-culture-live-export, v1)");
  }
  return value as LiveExport;
}

export function importLiveEntries(
  entries: readonly CultureRecord[],
  context: Omit<ValidationContext, "fileName">,
  options: { dir?: string; force?: boolean; dryRun?: boolean } = {},
): ImportResult {
  const dir = options.dir ?? ENTRIES_DIR;
  const result: ImportResult = { written: [], unchanged: [], conflicts: [], invalid: [] };
  for (const entry of entries) {
    // Only approved entries belong in git through an export; retired ones stay in D1 as history.
    const record: CultureRecord = { ...entry, status: "approved" };
    const errors = validateRecord(record, { ...context, fileName: `${record.id}.json` })
      .filter((i) => i.level === "error")
      .map((i) => i.message);
    if (errors.length > 0) {
      result.invalid.push({ id: String(record.id), errors });
      continue;
    }
    const path = join(dir, `${record.id}.json`);
    if (existsSync(path)) {
      if (readFileSync(path, "utf8") === formatRecord(record)) {
        result.unchanged.push(record.id);
        continue;
      }
      if (!options.force) {
        result.conflicts.push(record.id);
        continue;
      }
    }
    if (!options.dryRun) writeRecord(record, dir);
    result.written.push(record.id);
  }
  return result;
}
