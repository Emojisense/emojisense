/**
 * Structural check for hand/LLM-written enrichment files.
 *
 *   tsx scripts/check-enrichment.ts <input-batch.json> <output.json>...
 *
 * Verifies every hexcode of the input batch is covered exactly once and each record
 * follows the schema and size rules in enrichment/STYLE.md. Exits non-zero on errors.
 */
import { readFileSync } from "node:fs";
import { MAX_TOP } from "../src/alias-order.ts";
import { ALIAS_CATEGORIES, type EnrichmentRecord } from "../src/types.ts";

const LIMITS = {
  en: { min: 30, max: 100 },
  tr: { min: 12, max: 60 },
  /** Small territories have little to say; padding them with noise hurts search. */
  flags: { en: { min: 20, max: 100 }, tr: { min: 8, max: 60 } },
  descMax: 160,
  aliasMaxChars: 48,
  aliasMaxWords: 6,
};
const EMOJI_CHAR = /\p{Extended_Pictographic}/u;

const [inputPath, ...outputPaths] = process.argv.slice(2);
if (!inputPath || outputPaths.length === 0) {
  console.error("usage: check-enrichment <input-batch.json> <output.json>...");
  process.exit(2);
}

const expected: { hexcode: string; group: string }[] = JSON.parse(readFileSync(inputPath, "utf8"));
const groupOf = new Map(expected.map((e) => [e.hexcode, e.group]));
const records: EnrichmentRecord[] = outputPaths.flatMap((p) => {
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("top level must be an array");
    return parsed;
  } catch (error) {
    console.error(`✘ ${p}: ${(error as Error).message}`);
    process.exit(1);
  }
  return [];
});

const errors: string[] = [];
const warnings: string[] = [];
const seen = new Map<string, number>();
for (const r of records) seen.set(r.hexcode, (seen.get(r.hexcode) ?? 0) + 1);

for (const { hexcode } of expected) {
  const count = seen.get(hexcode) ?? 0;
  if (count === 0) errors.push(`${hexcode}: missing`);
  if (count > 1) errors.push(`${hexcode}: duplicated ${count}x`);
}
const expectedSet = new Set(expected.map((e) => e.hexcode));
for (const r of records) if (!expectedSet.has(r.hexcode)) errors.push(`${r.hexcode}: not in input batch`);

for (const r of records) {
  for (const locale of ["en", "tr"] as const) {
    const where = `${r.hexcode} ${r.emoji} ${locale}`;
    const block = r[locale];
    if (!block || typeof block !== "object") {
      errors.push(`${where}: missing block`);
      continue;
    }
    if (typeof block.desc !== "string" || block.desc.length < 10) errors.push(`${where}: desc missing/short`);
    else if (block.desc.length > LIMITS.descMax) warnings.push(`${where}: desc > ${LIMITS.descMax} chars`);

    const all: string[] = [];
    if (Array.isArray(block.top) && block.top.length > MAX_TOP) {
      errors.push(`${where}: "top" has ${block.top.length} phrases (max ${MAX_TOP})`);
    }
    // `top` is optional; when present it is checked like any other alias list.
    for (const category of ["top", ...ALIAS_CATEGORIES, "low"] as const) {
      const list = category === "top" ? (block.top ?? []) : block[category];
      if (!Array.isArray(list)) {
        errors.push(`${where}: "${category}" must be an array (use [] when empty)`);
        continue;
      }
      for (const alias of list) {
        if (typeof alias !== "string" || alias.trim() === "") {
          errors.push(`${where}: empty/non-string alias in ${category}`);
          continue;
        }
        if (alias !== alias.toLocaleLowerCase(locale === "tr" ? "tr" : "en"))
          errors.push(`${where}: not lowercase "${alias}"`);
        if (EMOJI_CHAR.test(alias)) errors.push(`${where}: emoji char in alias "${alias}"`);
        if (alias.length > LIMITS.aliasMaxChars) errors.push(`${where}: too long "${alias}"`);
        if (alias.split(/\s+/).length > LIMITS.aliasMaxWords)
          warnings.push(`${where}: many words "${alias}"`);
        if (category !== "low") all.push(alias);
      }
    }
    const unique = new Set(all);
    if (unique.size !== all.length) warnings.push(`${where}: ${all.length - unique.size} duplicate aliases`);
    for (const alias of block.low ?? []) {
      if (block.top?.includes(alias)) warnings.push(`${where}: top "${alias}" is also low`);
      else if (!unique.has(alias)) errors.push(`${where}: low-confidence "${alias}" is not in any category`);
    }
    const { min, max } = groupOf.get(r.hexcode) === "flags" ? LIMITS.flags[locale] : LIMITS[locale];
    if (unique.size < min) errors.push(`${where}: only ${unique.size} aliases (min ${min})`);
    if (unique.size > max) errors.push(`${where}: ${unique.size} aliases (max ${max})`);
  }
}

for (const w of warnings.slice(0, 40)) console.warn(`⚠ ${w}`);
if (warnings.length > 40) console.warn(`⚠ …and ${warnings.length - 40} more warnings`);
for (const e of errors.slice(0, 80)) console.error(`✘ ${e}`);
if (errors.length > 80) console.error(`✘ …and ${errors.length - 80} more errors`);
console.log(
  `${errors.length === 0 ? "✔" : "✘"} ${records.length}/${expected.length} records, ` +
    `${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length === 0 ? 0 : 1);
