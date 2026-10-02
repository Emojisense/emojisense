/**
 * Structural check for one-locale alias files (enrichment/STYLE_I18N.md).
 *
 *   tsx scripts/check-locale.ts <locale> <input-batch.json> <output.json>...
 *
 * Every hexcode of the input batch must appear exactly once; each record must follow the
 * schema and size rules. Exits non-zero on errors.
 */
import { readFileSync } from "node:fs";
import { normalize } from "emojisense";
import { localeInfo } from "../src/locales.ts";
import { ALIAS_CATEGORIES, type LocaleRecord } from "../src/types.ts";

const LIMITS = {
  min: 12,
  max: 50,
  flagsMin: 6,
  descMin: 8,
  descMax: 160,
  aliasMaxChars: 48,
  aliasMaxWords: 6,
};
const EMOJI_CHAR = /\p{Extended_Pictographic}/u;

const [locale, inputPath, ...outputPaths] = process.argv.slice(2);
if (!locale || !inputPath || outputPaths.length === 0) {
  console.error("usage: check-locale <locale> <input-batch.json> <output.json>...");
  process.exit(2);
}
localeInfo(locale);

const expected: { hexcode: string; group: string; label: string | null; tags: string[] }[] = JSON.parse(
  readFileSync(inputPath, "utf8"),
);
const inputByHexcode = new Map(expected.map((e) => [e.hexcode, e]));
const records: LocaleRecord[] = [];
for (const path of outputPaths) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("top level must be an array");
    records.push(...parsed);
  } catch (error) {
    console.error(`✘ ${path}: ${(error as Error).message}`);
    process.exit(1);
  }
}

const errors: string[] = [];
const warnings: string[] = [];
const seen = new Map<string, number>();
for (const r of records) seen.set(r.hexcode, (seen.get(r.hexcode) ?? 0) + 1);
for (const { hexcode } of expected) {
  const count = seen.get(hexcode) ?? 0;
  if (count === 0) errors.push(`${hexcode}: missing`);
  if (count > 1) errors.push(`${hexcode}: duplicated ${count}x`);
}

for (const r of records) {
  const input = inputByHexcode.get(r.hexcode);
  const where = `${r.hexcode} ${r.emoji}`;
  if (!input) {
    errors.push(`${where}: not in input batch`);
    continue;
  }
  if (typeof r.desc !== "string" || r.desc.length < LIMITS.descMin)
    errors.push(`${where}: desc missing/short`);
  else if (r.desc.length > LIMITS.descMax) warnings.push(`${where}: desc > ${LIMITS.descMax} chars`);

  const cldr = new Set([input.label ?? "", ...input.tags].map((s) => normalize(s)));
  const unique = new Set<string>();
  for (const category of [...ALIAS_CATEGORIES, "low"] as const) {
    const list = r[category];
    if (!Array.isArray(list)) {
      errors.push(`${where}: "${category}" must be an array (use [] when empty)`);
      continue;
    }
    for (const alias of list) {
      if (typeof alias !== "string" || alias.trim() === "") {
        errors.push(`${where}: empty/non-string alias in ${category}`);
        continue;
      }
      if (alias !== alias.toLocaleLowerCase(locale)) errors.push(`${where}: not lowercase "${alias}"`);
      if (EMOJI_CHAR.test(alias)) errors.push(`${where}: emoji char in "${alias}"`);
      if (alias.length > LIMITS.aliasMaxChars) errors.push(`${where}: too long "${alias}"`);
      if (alias.split(/\s+/).length > LIMITS.aliasMaxWords) warnings.push(`${where}: many words "${alias}"`);
      if (category === "low") continue;
      const key = normalize(alias);
      if (cldr.has(key)) warnings.push(`${where}: repeats a CLDR label/keyword "${alias}"`);
      if (unique.has(key)) warnings.push(`${where}: duplicate "${alias}"`);
      unique.add(key);
    }
  }
  for (const alias of r.low ?? []) {
    if (![...ALIAS_CATEGORIES].some((c) => r[c]?.includes(alias))) {
      errors.push(`${where}: low "${alias}" is not in any category`);
    }
  }
  const min = input.group === "flags" ? LIMITS.flagsMin : LIMITS.min;
  if (unique.size < min) errors.push(`${where}: only ${unique.size} aliases (min ${min})`);
  if (unique.size > LIMITS.max) errors.push(`${where}: ${unique.size} aliases (max ${LIMITS.max})`);
}

for (const w of warnings.slice(0, 30)) console.warn(`⚠ ${w}`);
if (warnings.length > 30) console.warn(`⚠ …and ${warnings.length - 30} more warnings`);
for (const e of errors.slice(0, 60)) console.error(`✘ ${e}`);
if (errors.length > 60) console.error(`✘ …and ${errors.length - 60} more errors`);
console.log(
  `${errors.length === 0 ? "✔" : "✘"} ${locale}: ${records.length}/${expected.length} records, ${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length === 0 ? 0 : 1);
