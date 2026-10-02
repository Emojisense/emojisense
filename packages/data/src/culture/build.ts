/**
 * Approved culture entries → dist/culture/<packVersion>/culture.<locale>.json (docs/PACK_FORMAT.md §8).
 *
 *   tsx src/culture/build.ts [--date YYYY-MM-DD] [--days 14] [--out DIR]
 *
 * Each file holds the lasting entries plus the seasonal and event entries active on any day of
 * [date, date + days], with their exact windows, so the SDK switches them on and off offline.
 * The Worker sync publishes the directory with `Cache-Control: max-age=3600` (not immutable):
 * rebuild it daily.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { localDay } from "emojisense";
import { readPackConfig } from "../config.ts";
import { LOCALE_CODES } from "../locales.ts";
import { DATA_ROOT } from "../paths.ts";
import { loadCatalog } from "./catalog.ts";
import { addDays, compileCulture } from "./compile.ts";
import { loadExclusions } from "./exclusions.ts";
import { loadRecords } from "./records.ts";
import { validateRecords } from "./validate.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    date: { type: "string" },
    days: { type: "string", default: "14" },
    out: { type: "string" },
  },
});

const from = args.date ?? localDay();
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from))) {
  console.error(`culture:build: --date must be YYYY-MM-DD, got "${from}"`);
  process.exit(2);
}
const days = Number(args.days);
const { packVersion } = readPackConfig();
const catalog = loadCatalog();
const loaded = loadRecords();
const errors = validateRecords(loaded, { catalog, exclusions: loadExclusions() }).filter(
  (i) => i.level === "error",
);
if (errors.length > 0) {
  for (const e of errors) console.error(`✘ ${e.id}: ${e.message}`);
  console.error(`culture:build: ${errors.length} validation errors (pnpm culture:check)`);
  process.exit(1);
}

const outDir = args.out ?? join(DATA_ROOT, "dist", "culture", packVersion);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const records = loaded.map((l) => l.record);
const index: Record<string, { entries: number; relevantNow: string[]; bytes: number; gzipBytes: number }> =
  {};
for (const locale of LOCALE_CODES) {
  const culture = compileCulture(records, locale, { packVersion, from, days, catalog });
  const json = JSON.stringify(culture);
  writeFileSync(join(outDir, `culture.${locale}.json`), json);
  const bytes = Buffer.byteLength(json);
  const gzipBytes = gzipSync(json, { level: 9 }).length;
  index[locale] = { entries: culture.entries.length, relevantNow: culture.relevantNow, bytes, gzipBytes };
  const kb = (n: number) => (n / 1024).toFixed(1).padStart(5);
  console.log(
    `culture: ${locale.padEnd(3)} ${String(culture.entries.length).padStart(3)} entries ` +
      `${kb(bytes)} KB raw ${kb(gzipBytes)} KB gz` +
      (culture.relevantNow.length > 0 ? `  now: ${culture.relevantNow.join(", ")}` : ""),
  );
}
const summary = {
  format: "emojisense-culture-index",
  formatVersion: 1,
  packVersion,
  from,
  until: addDays(from, days),
  locales: index,
};
writeFileSync(join(outDir, "index.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`culture: ${records.filter((r) => r.status === "approved").length} approved entries → ${outDir}`);
