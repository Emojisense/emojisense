import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CULTURE_DIR } from "../paths.ts";
import type { CultureRecord } from "./types.ts";

export const ENTRIES_DIR = join(CULTURE_DIR, "entries");

export interface LoadedRecord {
  record: CultureRecord;
  fileName: string;
  path: string;
}

/** Every `entries/*.json`, sorted by file name. Parse errors name the file. */
export function loadRecords(dir = ENTRIES_DIR): LoadedRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((fileName) => {
      const path = join(dir, fileName);
      try {
        return { record: JSON.parse(readFileSync(path, "utf8")) as CultureRecord, fileName, path };
      } catch (error) {
        throw new Error(`culture: ${fileName} is not valid JSON (${(error as Error).message})`);
      }
    });
}

/** Key order of a record file, so diffs stay small and reviews read the same way. */
const KEY_ORDER: (keyof CultureRecord)[] = [
  "id",
  "status",
  "kind",
  "context",
  "when",
  "regions",
  "locales",
  "triggers",
  "emoji",
  "featured",
  "source",
  "createdBy",
  "reviewedBy",
  "createdAt",
];

export function formatRecord(record: CultureRecord): string {
  const ordered = Object.fromEntries(
    [...KEY_ORDER, ...Object.keys(record).filter((k) => !KEY_ORDER.includes(k as keyof CultureRecord))]
      .filter((key) => record[key as keyof CultureRecord] !== undefined)
      .map((key) => [key, record[key as keyof CultureRecord]]),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function writeRecord(record: CultureRecord, dir = ENTRIES_DIR): string {
  const path = join(dir, `${record.id}.json`);
  writeFileSync(path, formatRecord(record));
  return path;
}
