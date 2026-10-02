/**
 * Step 4: base + validated aliases → dist/packs/<packVersion>/ and build/documents.json
 * (the text each embedding model sees per emoji).
 *
 *   tsx src/build-pack.ts [--initial-aliases N] [--out DIR]
 *
 * Per locale, two client files:
 *   pack.<locale>.json      core: label, shortcodes, keywords + the first N aliases (size budget)
 *   pack.<locale>.ext.json  ext:  the remaining aliases, typos and low-confidence phrases
 * Clients render with core and load ext when idle. Embedding documents use the full alias list.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { normalize, PACK_FORMAT, PACK_FORMAT_VERSION, type Pack, type PackRow } from "emojisense";
import { LOCALE_CODES } from "./locales.ts";
import { writeManifest } from "./manifest.ts";
import { BASE_FILE, BUILD_DIR, DATA_ROOT } from "./paths.ts";
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
const initialAliases = Number(args["initial-aliases"] ?? config.initialAliases);
const { source, emoji }: { source: Record<string, string>; emoji: BaseEmoji[] } = JSON.parse(
  readFileSync(BASE_FILE, "utf8"),
);
const validated: Validated = JSON.parse(readFileSync(join(BUILD_DIR, "validated.json"), "utf8"));
const groups = [...new Set(emoji.map((e) => e.group))];

/** Normalize, drop phrases already present in a stronger field, join with "|". */
function fields(lists: string[][]): string[] {
  const seen = new Set<string>();
  return lists.map((list) =>
    list
      .map((s) => normalize(s))
      .filter((s) => s !== "" && !seen.has(s) && seen.add(s))
      .join("|"),
  );
}

function buildPacks(locale: string): { core: Pack; ext: Pack } {
  const core: PackRow[] = [];
  const ext: PackRow[] = [];
  for (const e of emoji) {
    const v = validated[e.hexcode]?.[locale];
    const cldr = e.i18n[locale];
    const label = locale === "en" ? e.label : (cldr?.label ?? e.label);
    const aliases = v?.alias ?? [];
    const [, shortcode, keyword, alias, typo, low, extAlias] = fields([
      [label],
      locale === "en" ? e.shortcodes : [],
      locale === "en" ? e.tags : (cldr?.tags ?? []),
      aliases.slice(0, initialAliases),
      v?.typo ?? [],
      v?.low ?? [],
      aliases.slice(initialAliases),
    ]) as string[];
    const head = [
      e.emoji,
      e.hexcode,
      groups.indexOf(e.group),
      e.version,
      e.skins.length > 0 ? 1 : 0,
    ] as const;
    core.push([...head, label, shortcode as string, keyword as string, alias as string, "", ""]);
    ext.push([...head, "", "", "", extAlias as string, typo as string, low as string]);
  }
  const pack = (part: "core" | "ext", rows: PackRow[]): Pack => ({
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    packVersion: config.packVersion,
    locale,
    ...(part === "ext" ? { part } : {}),
    emojiVersion: config.emojiVersion,
    groups,
    emoji: rows,
  });
  return { core: pack("core", core), ext: pack("ext", ext) };
}

/** Aliases per document, so en + tr stay well under the 512-token limit of some models. */
const DOC_ALIASES = { en: 40, tr: 20 };

/** One document per emoji. Multilingual models also get the Turkish text. */
function buildDocuments() {
  return emoji.map((e) => {
    const en = validated[e.hexcode]?.en;
    const tr = validated[e.hexcode]?.tr;
    const enTerms = [...e.tags, ...(en?.alias ?? []).slice(0, DOC_ALIASES.en)];
    const trCldr = e.i18n.tr;
    const trTerms = [
      trCldr?.label ?? "",
      ...(trCldr?.tags ?? []),
      ...(tr?.alias ?? []).slice(0, DOC_ALIASES.tr),
    ];
    const enText = [en?.desc ?? "", enTerms.join(", ")].join(" ");
    const trText = [tr?.desc ?? "", trTerms.join(", ")].join(" ");
    return { hexcode: e.hexcode, title: e.label, en: enText.trim(), tr: trText.trim() };
  });
}

const outDir = args.out ?? join(DATA_ROOT, "dist", "packs", config.packVersion);
// Replace only the pack files: vector files in the same directory come from the (paid) embed step.
mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) if (/^pack\.[\w.-]+\.json$/.test(file)) rmSync(join(outDir, file));
for (const locale of LOCALE_CODES) {
  const { core, ext } = buildPacks(locale);
  writeFileSync(join(outDir, `pack.${locale}.json`), JSON.stringify(core));
  writeFileSync(join(outDir, `pack.${locale}.ext.json`), JSON.stringify(ext));
}
writeFileSync(join(BUILD_DIR, "documents.json"), `${JSON.stringify(buildDocuments(), null, 1)}\n`);

const manifest = writeManifest(outDir, {
  packVersion: config.packVersion,
  emojiVersion: config.emojiVersion,
  source,
  emojiCount: emoji.length,
});
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
for (const [name, f] of Object.entries(manifest.files)) {
  console.log(`pack: ${name.padEnd(16)} ${kb(f.bytes).padStart(10)} raw  ${kb(f.gzipBytes).padStart(9)} gz`);
}
console.log(`pack: wrote ${outDir} (core keeps ${initialAliases} aliases per emoji and locale)`);
