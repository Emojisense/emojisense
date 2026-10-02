/**
 * Step 4: base + validated aliases → dist/packs/<packVersion>/{pack.en.json, pack.tr.json, manifest.json}
 * and build/documents.json (the text each embedding model sees per emoji).
 *
 *   tsx src/build-pack.ts [--max-aliases N] [--out DIR]
 *
 * --max-aliases caps generated aliases per emoji and locale in the client pack (size budget).
 * Documents for embeddings always use the full alias list.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { normalize, PACK_FORMAT, PACK_FORMAT_VERSION, type Pack, type PackRow } from "emojisense";
import { writeManifest } from "./manifest.ts";
import { BASE_FILE, BUILD_DIR, DATA_ROOT } from "./paths.ts";
import type { BaseEmoji } from "./types.ts";
import type { Validated } from "./validate.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { "max-aliases": { type: "string" }, out: { type: "string" } },
});
const maxAliases = args["max-aliases"] ? Number(args["max-aliases"]) : Number.POSITIVE_INFINITY;
const config: { packVersion: string; emojiVersion: string } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
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

function buildPack(locale: "en" | "tr"): Pack {
  const rows = emoji.map((e): PackRow => {
    const v = validated[e.hexcode]?.[locale];
    const label = locale === "en" ? e.label : (e.tr.label ?? e.label);
    const [, shortcode, keyword, alias, typo, low] = fields([
      [label],
      locale === "en" ? e.shortcodes : [],
      locale === "en" ? e.tags : e.tr.tags,
      (v?.alias ?? []).slice(0, maxAliases),
      v?.typo ?? [],
      v?.low ?? [],
    ]) as string[];
    return [
      e.emoji,
      e.hexcode,
      groups.indexOf(e.group),
      e.version,
      e.skins.length > 0 ? 1 : 0,
      label,
      shortcode as string,
      keyword as string,
      alias as string,
      typo as string,
      low as string,
    ];
  });
  return {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    packVersion: config.packVersion,
    locale,
    emojiVersion: config.emojiVersion,
    groups,
    emoji: rows,
  };
}

/** Aliases per document, so en + tr stay well under the 512-token limit of some models. */
const DOC_ALIASES = { en: 40, tr: 20 };

/** One document per emoji. Multilingual models also get the Turkish text. */
function buildDocuments() {
  return emoji.map((e) => {
    const en = validated[e.hexcode]?.en;
    const tr = validated[e.hexcode]?.tr;
    const enTerms = [...e.tags, ...(en?.alias ?? []).slice(0, DOC_ALIASES.en)];
    const trTerms = [e.tr.label ?? "", ...e.tr.tags, ...(tr?.alias ?? []).slice(0, DOC_ALIASES.tr)];
    const enText = [en?.desc ?? "", enTerms.join(", ")].join(" ");
    const trText = [tr?.desc ?? "", trTerms.join(", ")].join(" ");
    return { hexcode: e.hexcode, title: e.label, en: enText.trim(), tr: trText.trim() };
  });
}

const outDir = args.out ?? join(DATA_ROOT, "dist", "packs", config.packVersion);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const locale of ["en", "tr"] as const) {
  writeFileSync(join(outDir, `pack.${locale}.json`), JSON.stringify(buildPack(locale)));
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
console.log(`pack: wrote ${outDir}${Number.isFinite(maxAliases) ? ` (max ${maxAliases} aliases)` : ""}`);
