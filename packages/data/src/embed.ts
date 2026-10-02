/**
 * Step 5: build/documents.json → dist/packs/<v>/vectors.<model>.<dims>.bin (+ manifest update)
 *
 *   tsx src/embed.ts [--models bge-small,bge-m3,embeddinggemma,qwen3] [--dims 768,512,256,128]
 *
 * Every model is embedded once at native dims; smaller dims are truncated and re-normalized
 * (Matryoshka). Non-MRL models get truncations too, but the report flags them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { encodeVectors, l2normalize } from "emojisense";
import { disposeEmbeddings, embedTexts } from "./embeddings.ts";
import { writeManifest } from "./manifest.ts";
import { formatDocument, getModel, MODELS } from "./models.ts";
import { BUILD_DIR, DATA_ROOT } from "./paths.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { models: { type: "string" }, dims: { type: "string" } },
});
const models = args.models ? args.models.split(",").map(getModel) : MODELS;
const dimsList = (args.dims ?? "768,512,256,128").split(",").map(Number);

const config = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"));
const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);
const documents: { hexcode: string; title: string; en: string; tr: string }[] = JSON.parse(
  readFileSync(join(BUILD_DIR, "documents.json"), "utf8"),
);
const ids = documents.map((d) => d.hexcode);

try {
  for (const model of models) {
    const texts = documents.map((d) =>
      formatDocument(model, d.title, model.multilingual ? `${d.en} | ${d.tr}` : d.en),
    );
    const started = performance.now();
    const { vectors, stats } = await embedTexts(model, texts, "document", {
      onProgress: (n) => process.stdout.write(`\r${model.key}: ${n}/${texts.length}`),
    });
    process.stdout.write("\n");
    const nativeDims = vectors[0]?.length ?? 0;
    if (nativeDims !== model.nativeDims) {
      console.warn(`⚠ ${model.key}: got ${nativeDims} dims, registry says ${model.nativeDims}`);
    }
    for (const dims of [...new Set([nativeDims, ...dimsList])].filter((d) => d <= nativeDims)) {
      const rows = vectors.map((v) => l2normalize(v.slice(0, dims)));
      writeFileSync(join(packDir, `vectors.${model.key}.${dims}.bin`), encodeVectors(model.id, ids, rows));
    }
    console.log(
      `embed: ${model.key} ${stats.cached} cached + ${stats.fetched} fetched ` +
        `in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
  }
} finally {
  await disposeEmbeddings();
}

writeManifest(packDir, {
  packVersion: config.packVersion,
  emojiVersion: config.emojiVersion,
  emojiCount: ids.length,
});
