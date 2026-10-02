/**
 * Split the catalog into work batches for alias generation.
 *
 *   tsx scripts/make-batches.ts                     → enrichment/_batches/bNN.input.json (en + tr, first wave)
 *   tsx scripts/make-batches.ts --locale es [--size 240]
 *        → enrichment/_batches/es/bNN.input.json, grounded on the English aliases (run validate first)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { localeInfo } from "../src/locales.ts";
import { BASE_FILE, BUILD_DIR, ENRICHMENT_DIR } from "../src/paths.ts";
import type { BaseEmoji } from "../src/types.ts";
import type { Validated } from "../src/validate.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { locale: { type: "string" }, size: { type: "string" } },
});
const NON_FLAG_BATCH = 87;
const FLAG_BATCH = 90;
const GROUNDING_ALIASES = 15;

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));

function chunk<T>(items: T[], size: number): T[][] {
  const count = Math.ceil(items.length / size);
  const even = Math.ceil(items.length / count);
  return Array.from({ length: count }, (_, i) => items.slice(i * even, (i + 1) * even));
}

function write(dir: string, batches: unknown[][]) {
  mkdirSync(dir, { recursive: true });
  batches.forEach((batch, i) => {
    const name = `b${String(i + 1).padStart(2, "0")}`;
    writeFileSync(join(dir, `${name}.input.json`), `${JSON.stringify(batch, null, 1)}\n`);
  });
  console.log(`batches: ${batches.length} in ${dir} (${batches.map((b) => b.length).join(", ")})`);
}

if (args.locale) {
  const locale = localeInfo(args.locale).code;
  const validated: Validated = JSON.parse(readFileSync(join(BUILD_DIR, "validated.json"), "utf8"));
  const inputs = emoji.map((e) => ({
    hexcode: e.hexcode,
    emoji: e.emoji,
    group: e.group,
    en_label: e.label,
    en_desc: validated[e.hexcode]?.en?.desc ?? "",
    en_aliases: (validated[e.hexcode]?.en?.alias ?? []).slice(0, GROUNDING_ALIASES),
    label: e.i18n[locale]?.label ?? null,
    tags: e.i18n[locale]?.tags ?? [],
  }));
  write(join(ENRICHMENT_DIR, "_batches", locale), chunk(inputs, Number(args.size ?? 240)));
} else {
  const inputs = emoji.map((e) => ({
    hexcode: e.hexcode,
    emoji: e.emoji,
    label: e.label,
    tags: e.tags,
    shortcodes: e.shortcodes,
    group: e.group,
    subgroup: e.subgroup,
    tr_label: e.i18n.tr?.label ?? null,
    tr_tags: e.i18n.tr?.tags ?? [],
  }));
  write(join(ENRICHMENT_DIR, "_batches"), [
    ...chunk(
      inputs.filter((e) => e.group !== "flags"),
      NON_FLAG_BATCH,
    ),
    ...chunk(
      inputs.filter((e) => e.group === "flags"),
      FLAG_BATCH,
    ),
  ]);
}
