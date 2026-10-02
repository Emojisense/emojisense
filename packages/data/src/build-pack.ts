/**
 * Step 4: base + validated aliases → dist/packs/<packVersion>/ and build/documents.json
 * (the text each embedding model sees per emoji and locale; documents.ts).
 *
 *   tsx src/build-pack.ts [--initial-aliases N] [--out DIR]
 *
 * Per locale, two client files:
 *   pack.<locale>.json      core: label, shortcodes, keywords + the first N aliases (size budget)
 *   pack.<locale>.ext.json  ext:  the remaining aliases, typos and low-confidence phrases
 * A CLDR keyword that curation.json demotes moves to the ext `low` field; a removed one is left out
 * (pack-fields.ts). The CLDR label stays.
 * N starts at `initialAliases` (pack.config.json, or --initial-aliases) and drops one step at a
 * time until the core part fits CORE_BUDGET_GZ. The manifest records N per locale (`coreAliases`).
 * Clients render with core and load ext when idle. Embedding documents use the full alias list.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PACK_FORMAT, PACK_FORMAT_VERSION, type Pack, type PackRow } from "emojisense";
import { loadCurations } from "./curation.ts";
import { buildDocuments } from "./documents.ts";
import { LOCALE_CODES } from "./locales.ts";
import { gzipSize, writeManifest } from "./manifest.ts";
import { packFields } from "./pack-fields.ts";
import { BASE_FILE, BUILD_DIR, DATA_ROOT, ENRICHMENT_DIR } from "./paths.ts";
import { loadPopularity, POPULARITY_CREDIT, popularityOf } from "./popularity.ts";
import type { BaseEmoji } from "./types.ts";
import type { Validated } from "./validate.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { "initial-aliases": { type: "string" }, out: { type: "string" } },
});
const config: { packVersion: string; emojiVersion: string; initialAliases: number } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
/** The most aliases per emoji a core part keeps; a locale gets fewer when its core is too big. */
const maxAliases = Number(args["initial-aliases"] ?? config.initialAliases);
/** PACK_FORMAT.md: every core part is ≤ 200 KB gzip, so the first render stays fast. */
const CORE_BUDGET_GZ = 200 * 1024;
const { source, emoji }: { source: Record<string, string>; emoji: BaseEmoji[] } = JSON.parse(
  readFileSync(BASE_FILE, "utf8"),
);
const validated: Validated = JSON.parse(readFileSync(join(BUILD_DIR, "validated.json"), "utf8"));
/** Aliases were curated in validate.ts; the CLDR keywords are curated here (pack-fields.ts). */
const curations = loadCurations(join(ENRICHMENT_DIR, "curation.json"));
const groups = [...new Set(emoji.map((e) => e.group))];
/** The popularity prior (popularity.ts) rides in the English core pack, which every client loads. */
const popularity = popularityOf(
  emoji.map((e) => e.hexcode),
  loadPopularity(),
);

function buildPacks(locale: string, coreAliasCount: number): { core: Pack; ext: Pack } {
  const core: PackRow[] = [];
  const ext: PackRow[] = [];
  for (const e of emoji) {
    const { label, shortcode, keyword, alias, typo, low, extAlias } = packFields(
      e,
      locale,
      validated[e.hexcode]?.[locale],
      coreAliasCount,
      curations,
    );
    const head = [
      e.emoji,
      e.hexcode,
      groups.indexOf(e.group),
      e.version,
      e.skins.length > 0 ? 1 : 0,
    ] as const;
    core.push([...head, label, shortcode, keyword, alias, "", ""]);
    ext.push([...head, "", "", "", extAlias, typo, low]);
  }
  const pack = (part: "core" | "ext", rows: PackRow[]): Pack => ({
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    packVersion: config.packVersion,
    locale,
    ...(part === "ext" ? { part } : {}),
    emojiVersion: config.emojiVersion,
    groups,
    ...(part === "core" && locale === "en" ? { popularity } : {}),
    emoji: rows,
  });
  return { core: pack("core", core), ext: pack("ext", ext) };
}

const outDir = args.out ?? join(DATA_ROOT, "dist", "packs", config.packVersion);
// Replace only the pack files: vector files in the same directory come from the (paid) embed step.
mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) if (/^pack\.[\w.-]+\.json$/.test(file)) rmSync(join(outDir, file));
/** The largest alias count (≤ maxAliases) whose core part fits the budget. */
function fitCore(locale: string): { core: string; ext: string; aliases: number } {
  for (let aliases = maxAliases; ; aliases--) {
    const { core, ext } = buildPacks(locale, aliases);
    const coreJson = JSON.stringify(core);
    if (gzipSize(coreJson) <= CORE_BUDGET_GZ || aliases === 0) {
      if (aliases === 0 && gzipSize(coreJson) > CORE_BUDGET_GZ) {
        console.warn(`⚠ pack.${locale}.json is over the core budget even without aliases`);
      }
      return { core: coreJson, ext: JSON.stringify(ext), aliases };
    }
  }
}

const coreAliases: Record<string, number> = {};
for (const locale of LOCALE_CODES) {
  const { core, ext, aliases } = fitCore(locale);
  coreAliases[locale] = aliases;
  writeFileSync(join(outDir, `pack.${locale}.json`), core);
  writeFileSync(join(outDir, `pack.${locale}.ext.json`), ext);
}
writeFileSync(
  join(BUILD_DIR, "documents.json"),
  `${JSON.stringify(buildDocuments(emoji, validated, LOCALE_CODES), null, 1)}\n`,
);

const manifest = writeManifest(outDir, {
  packVersion: config.packVersion,
  emojiVersion: config.emojiVersion,
  // CC BY 4.0 asks for the credit wherever the data goes: the published manifest carries it.
  source: { ...source, popularity: POPULARITY_CREDIT },
  emojiCount: emoji.length,
  coreAliases,
});
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
for (const [name, f] of Object.entries(manifest.files)) {
  console.log(`pack: ${name.padEnd(16)} ${kb(f.bytes).padStart(10)} raw  ${kb(f.gzipBytes).padStart(9)} gz`);
}
const fitted = Object.entries(coreAliases).map(([locale, n]) => `${locale} ${n}`);
console.log(`pack: wrote ${outDir} (core aliases per emoji, max ${maxAliases}: ${fitted.join(", ")})`);
