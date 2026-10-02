/**
 * Glyph vectors: build/emoji.base.json + enrichment → vectors.<model>.<dims>.glyph.bin
 *
 *   tsx src/embed-glyph.ts [--kinds glyph,name,context] [--locales en] [--contexts 3]
 *                          [--no-inherit] [--split DIR] [--concurrency 4] [--model M --dims D]
 *                          [--template]
 *
 * One multi-vector file per model × dims with every selected kind (default: the bare glyph;
 * glyph-documents.ts), rows in
 * pack order per kind (PACK_FORMAT.md §5, "Glyph file"). `--split DIR` writes one file per kind
 * to DIR instead (`glyph.<kind>.bin`), for `eval:glyph`. Texts are embedded as they are (no
 * document template) through the same cached Workers AI path as `embed`. `--template` wraps each
 * text in the model's document template with the title "none" (EmbeddingGemma's documented
 * document prompt; `eval:models` compares models with their own prompts).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { encodeVectors, l2normalize } from "emojisense/vectors";
import { disposeEmbeddings, embedTexts } from "./embeddings.ts";
import {
  buildGlyphTexts,
  DEFAULT_CONTEXTS,
  GLYPH_KINDS,
  type GlyphKind,
  loadPhraseSource,
  type ValidatedAliases,
} from "./glyph-documents.ts";
import { writeManifest } from "./manifest.ts";
import { formatDocument, getModel } from "./models.ts";
import { BASE_FILE, BUILD_DIR, DATA_ROOT, ENRICHMENT_DIR } from "./paths.ts";
import { degenerateRows } from "./semantic-score.ts";
import type { BaseEmoji } from "./types.ts";
import { glyphVectorFileName } from "./vector-files.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    model: { type: "string" },
    dims: { type: "string" },
    kinds: { type: "string" },
    locales: { type: "string", default: "en" },
    contexts: { type: "string", default: String(DEFAULT_CONTEXTS) },
    "no-inherit": { type: "boolean", default: false },
    split: { type: "string" },
    concurrency: { type: "string", default: "4" },
    template: { type: "boolean", default: false },
  },
});

const config = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"));
const glyphConfig: { kinds: GlyphKind[]; locales: string[]; contexts: number } | undefined = config.glyph;
const model = getModel(args.model ?? config.model.key);
const dims = Number(args.dims ?? config.model.dims);
const kinds = (args.kinds?.split(",") ?? glyphConfig?.kinds ?? ["glyph"]) as GlyphKind[];
const unknownKinds = kinds.filter((k) => !(GLYPH_KINDS as readonly string[]).includes(k));
if (unknownKinds.length)
  throw new Error(`unknown glyph kinds ${unknownKinds.join(", ")} (known: ${GLYPH_KINDS.join(", ")})`);
const locales = args.locales?.split(",") ?? glyphConfig?.locales ?? ["en"];
const contexts = Number(args.contexts ?? glyphConfig?.contexts ?? DEFAULT_CONTEXTS);

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
const validated: ValidatedAliases = JSON.parse(readFileSync(join(BUILD_DIR, "validated.json"), "utf8"));
const groups = [...new Set(emoji.map((e) => e.group))];
const phrases = loadPhraseSource(ENRICHMENT_DIR, groups, locales);
const texts = buildGlyphTexts(emoji, phrases, validated, {
  kinds,
  locales,
  contexts,
  inherit: !args["no-inherit"],
});

const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);

try {
  const started = performance.now();
  const { vectors, stats } = await embedTexts(
    model,
    texts.map((t) => (args.template ? formatDocument(model, "none", t.text) : t.text)),
    "document",
    {
      concurrency: Number(args.concurrency),
      onProgress: (n) => process.stdout.write(`\r${model.key} glyph: ${n}/${texts.length}`),
    },
  );
  process.stdout.write("\n");
  // A text the model does not know (≈ half the bare glyphs) embeds to the same vector as every
  // other unknown text: those rows would only add noise, so they are dropped.
  const normalized = vectors.map((v) => l2normalize(v.slice(0, dims)));
  const data = new Float32Array(normalized.length * dims);
  normalized.forEach((v, i) => {
    data.set(v, i * dims);
  });
  // Keyed by text: a variant that inherits its base glyph repeats a known text, not an unknown one.
  const dropped = degenerateRows({
    model: model.id,
    dims,
    ids: texts.map((t) => t.text),
    data,
    signs: new Uint8Array(),
  });
  const kept = texts.flatMap((t, i) =>
    dropped.has(i) ? [] : [{ text: t, vector: normalized[i] as Float32Array }],
  );
  const encode = (rows: typeof kept) =>
    encodeVectors(
      model.id,
      rows.map((r) => r.text.hexcode),
      rows.map((r) => r.vector),
    );
  if (args.split) {
    mkdirSync(args.split, { recursive: true });
    for (const kind of kinds) {
      writeFileSync(join(args.split, `glyph.${kind}.bin`), encode(kept.filter((r) => r.text.kind === kind)));
    }
    writeFileSync(join(args.split, "glyph.texts.json"), `${JSON.stringify(texts)}\n`);
  } else {
    writeFileSync(join(packDir, glyphVectorFileName(model.key, dims)), encode(kept));
    writeManifest(packDir, {});
  }
  const counts = kinds
    .map(
      (k) =>
        `${k} ${kept.filter((r) => r.text.kind === k).length}/${texts.filter((t) => t.kind === k).length}`,
    )
    .join(", ");
  console.log(
    `embed-glyph: ${model.key}@${dims} (${counts}) ${stats.cached} cached + ${stats.fetched} fetched ` +
      `in ${stats.callMs.length} calls, ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
} finally {
  await disposeEmbeddings();
}
