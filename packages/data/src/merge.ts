/**
 * Collect batch parts written by the enrichment agents into one committed file per group:
 *   enrichment/_batches/bNN.pK.json → enrichment/<group>.json (sorted by Emojibase order)
 * Existing group files are kept and overridden per hexcode, so a partial batch can be merged.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_FILE, ENRICHMENT_DIR } from "./paths.ts";
import type { BaseEmoji, EnrichmentRecord } from "./types.ts";

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
const base = new Map(emoji.map((e) => [e.hexcode, e]));

const byHexcode = new Map<string, EnrichmentRecord>();
const groups = [...new Set(emoji.map((e) => e.group))];
for (const group of groups) {
  const path = join(ENRICHMENT_DIR, `${group}.json`);
  if (!existsSync(path)) continue;
  for (const record of JSON.parse(readFileSync(path, "utf8")) as EnrichmentRecord[]) {
    byHexcode.set(record.hexcode, record);
  }
}

const batchDir = join(ENRICHMENT_DIR, "_batches");
const parts = existsSync(batchDir) ? readdirSync(batchDir).filter((f) => /^b\d+\.p\d+\.json$/.test(f)) : [];
let added = 0;
for (const part of parts) {
  for (const record of JSON.parse(readFileSync(join(batchDir, part), "utf8")) as EnrichmentRecord[]) {
    if (!base.has(record.hexcode)) throw new Error(`${part}: unknown hexcode ${record.hexcode}`);
    byHexcode.set(record.hexcode, record);
    added++;
  }
}

for (const group of groups) {
  const records = emoji
    .filter((e) => e.group === group && byHexcode.has(e.hexcode))
    .map((e) => byHexcode.get(e.hexcode) as EnrichmentRecord);
  if (records.length === 0) continue;
  const body = records.map((r) => JSON.stringify(r)).join(",\n");
  writeFileSync(join(ENRICHMENT_DIR, `${group}.json`), `[\n${body}\n]\n`);
}

console.log(
  `merge: ${added} records from ${parts.length} batch parts; ` +
    `${byHexcode.size}/${emoji.length} emoji enriched`,
);
