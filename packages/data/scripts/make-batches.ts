/**
 * Split build/emoji.base.json into work batches for alias generation.
 *   tsx scripts/make-batches.ts → enrichment/_batches/bNN.input.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_FILE, ENRICHMENT_DIR } from "../src/paths.ts";
import type { BaseEmoji } from "../src/types.ts";

const NON_FLAG_BATCH = 87;
const FLAG_BATCH = 90;

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
const toInput = (e: BaseEmoji) => ({
  hexcode: e.hexcode,
  emoji: e.emoji,
  label: e.label,
  tags: e.tags,
  shortcodes: e.shortcodes,
  group: e.group,
  subgroup: e.subgroup,
  tr_label: e.tr.label,
  tr_tags: e.tr.tags,
});

function chunk<T>(items: T[], size: number): T[][] {
  const count = Math.ceil(items.length / size);
  const even = Math.ceil(items.length / count);
  return Array.from({ length: count }, (_, i) => items.slice(i * even, (i + 1) * even));
}

const batches = [
  ...chunk(
    emoji.filter((e) => e.group !== "flags"),
    NON_FLAG_BATCH,
  ),
  ...chunk(
    emoji.filter((e) => e.group === "flags"),
    FLAG_BATCH,
  ),
];
const dir = join(ENRICHMENT_DIR, "_batches");
mkdirSync(dir, { recursive: true });
batches.forEach((batch, i) => {
  const name = `b${String(i + 1).padStart(2, "0")}`;
  writeFileSync(join(dir, `${name}.input.json`), `${JSON.stringify(batch.map(toInput), null, 1)}\n`);
  console.log(`${name}: ${batch.length} (${batch[0]?.emoji} … ${batch.at(-1)?.emoji}) ${batch[0]?.group}`);
});
