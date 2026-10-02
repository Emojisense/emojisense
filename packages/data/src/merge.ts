/**
 * Collect batch parts written by the enrichment agents into committed files, one per group:
 *   enrichment/_batches/bNN.pK.json            → enrichment/<group>.json            (en + tr records)
 *   enrichment/_batches/<locale>/bNN.pK.json   → enrichment/i18n/<locale>/<group>.json
 * Existing files are kept and overridden per hexcode, so a partial batch can be merged.
 *
 *   tsx src/merge.ts [--locales es,fr]
 *
 * `--locales` merges only those locales, so batches that are still being written stay out
 * ("en" or "tr" selects the combined en + tr files). Default: every locale.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COMBINED_LOCALES, LOCALE_CODES, localeInfo } from "./locales.ts";
import { BASE_FILE, ENRICHMENT_DIR } from "./paths.ts";
import type { BaseEmoji } from "./types.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { locales: { type: "string" } },
});
const selected = args.locales
  ? args.locales
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => localeInfo(l).code)
  : LOCALE_CODES;
const isCombined = (l: string) => (COMBINED_LOCALES as readonly string[]).includes(l);

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
const known = new Set(emoji.map((e) => e.hexcode));
const groups = [...new Set(emoji.map((e) => e.group))];
const PART = /^b\d+\.p\d+\.json$/;

/** Merge `batchDir` parts into per-group files under `targetDir`. Returns [added, total]. */
function mergeInto(batchDir: string, targetDir: string): [number, number] {
  const byHexcode = new Map<string, { hexcode: string }>();
  for (const group of groups) {
    const path = join(targetDir, `${group}.json`);
    if (!existsSync(path)) continue;
    for (const r of JSON.parse(readFileSync(path, "utf8")) as { hexcode: string }[])
      byHexcode.set(r.hexcode, r);
  }
  let added = 0;
  const parts = existsSync(batchDir) ? readdirSync(batchDir).filter((f) => PART.test(f)) : [];
  for (const part of parts) {
    for (const record of JSON.parse(readFileSync(join(batchDir, part), "utf8")) as { hexcode: string }[]) {
      if (!known.has(record.hexcode))
        throw new Error(`${batchDir}/${part}: unknown hexcode ${record.hexcode}`);
      byHexcode.set(record.hexcode, record);
      added++;
    }
  }
  if (byHexcode.size === 0) return [0, 0];
  mkdirSync(targetDir, { recursive: true });
  for (const group of groups) {
    const records = emoji
      .filter((e) => e.group === group && byHexcode.has(e.hexcode))
      .map((e) => byHexcode.get(e.hexcode));
    if (records.length === 0) continue;
    writeFileSync(
      join(targetDir, `${group}.json`),
      `[\n${records.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`,
    );
  }
  return [added, byHexcode.size];
}

const batchRoot = join(ENRICHMENT_DIR, "_batches");
const lines: string[] = [];
if (selected.some(isCombined)) {
  const [added, total] = mergeInto(batchRoot, ENRICHMENT_DIR);
  lines.push(`en+tr: ${added} added, ${total}/${emoji.length} enriched`);
}
for (const locale of selected.filter((l) => !isCombined(l))) {
  const [localeAdded, localeTotal] = mergeInto(join(batchRoot, locale), join(ENRICHMENT_DIR, "i18n", locale));
  if (localeTotal > 0) lines.push(`${locale}: ${localeAdded} added, ${localeTotal}/${emoji.length}`);
}
console.log(`merge: ${lines.join(" | ")}`);
