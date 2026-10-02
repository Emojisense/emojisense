import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readPackConfig } from "../config.ts";
import { LOCALE_CODES } from "../locales.ts";
import { DATA_ROOT } from "../paths.ts";
import { loadCatalog } from "./catalog.ts";
import { addDays, compileCulture } from "./compile.ts";
import { loadExclusions } from "./exclusions.ts";
import { loadRecords } from "./records.ts";
import type { Issue } from "./types.ts";
import { validateRecords } from "./validate.ts";

export interface BuildCultureOptions {
  /** First day the files cover, "YYYY-MM-DD". */
  from: string;
  /** Days after `from` whose seasonal and event entries are included. Default 14. */
  days?: number;
  /** Default dist/culture/<packVersion>. Emptied first. */
  outDir?: string;
}

export interface LocaleSummary {
  entries: number;
  relevantNow: string[];
  bytes: number;
  gzipBytes: number;
}

export interface CultureBuild {
  outDir: string;
  packVersion: string;
  from: string;
  until: string;
  approved: number;
  locales: Record<string, LocaleSummary>;
}

export class CultureValidationError extends Error {
  constructor(readonly errors: Issue[]) {
    super(`culture: ${errors.length} validation errors (pnpm culture:check)`);
  }
}

/**
 * Approved entries → `culture.<locale>.json` for every pack locale plus `index.json`
 * (docs/PACK_FORMAT.md §9). Used by `culture:build` and the Worker sync. Throws
 * {@link CultureValidationError} when any entry has a validation error.
 */
export function buildCultureFiles(options: BuildCultureOptions): CultureBuild {
  const { from, days = 14 } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from))) {
    throw new Error(`culture: the first day must be YYYY-MM-DD, got "${from}"`);
  }
  const { packVersion } = readPackConfig();
  const catalog = loadCatalog();
  const loaded = loadRecords();
  const errors = validateRecords(loaded, { catalog, exclusions: loadExclusions() }).filter(
    (i) => i.level === "error",
  );
  if (errors.length > 0) throw new CultureValidationError(errors);

  const outDir = options.outDir ?? join(DATA_ROOT, "dist", "culture", packVersion);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const records = loaded.map((l) => l.record);
  const locales: Record<string, LocaleSummary> = {};
  for (const locale of LOCALE_CODES) {
    const culture = compileCulture(records, locale, { packVersion, from, days, catalog });
    const json = JSON.stringify(culture);
    writeFileSync(join(outDir, `culture.${locale}.json`), json);
    locales[locale] = {
      entries: culture.entries.length,
      relevantNow: culture.relevantNow,
      bytes: Buffer.byteLength(json),
      gzipBytes: gzipSync(json, { level: 9 }).length,
    };
  }
  const until = addDays(from, days);
  const summary = { format: "emojisense-culture-index", formatVersion: 1, packVersion, from, until, locales };
  writeFileSync(join(outDir, "index.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const approved = records.filter((r) => r.status === "approved").length;
  return { outDir, packVersion, from, until, approved, locales };
}
