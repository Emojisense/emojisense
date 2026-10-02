/**
 * Step 5: build/documents.json → dist/packs/<v>/vectors.<model>.<dims>[.<locale>].bin (+ manifest update)
 *
 *   tsx src/embed.ts [--models bge-small,bge-m3,embeddinggemma,qwen3] [--dims 768,512,256,128]
 *                    [--locales tr,es,…] [--concurrency 4]
 *
 * English documents go to the shared file `vectors.<model>.<dims>.bin`. A multilingual model also
 * gets one file per other pack locale (default: every locale in documents.json), embedded from that
 * locale's documents (documents.ts, PACK_FORMAT.md §5).
 *
 * Every model is embedded once at native dims; smaller dims are truncated and re-normalized
 * (Matryoshka). Non-MRL models get truncations too, but the report flags them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { encodeVectors, l2normalize } from "emojisense";
import type { EmojiDocuments } from "./documents.ts";
import { disposeEmbeddings, embedTexts } from "./embeddings.ts";
import { writeManifest } from "./manifest.ts";
import { formatDocument, getModel, MODELS } from "./models.ts";
import { BUILD_DIR, DATA_ROOT } from "./paths.ts";
import { vectorFileName } from "./vector-files.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    models: { type: "string" },
    dims: { type: "string" },
    locales: { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
});
const models = args.models ? args.models.split(",").map(getModel) : MODELS;
const dimsList = (args.dims ?? "768,512,256,128").split(",").map(Number);

const config = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"));
const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);
const documents: EmojiDocuments[] = JSON.parse(readFileSync(join(BUILD_DIR, "documents.json"), "utf8"));
const ids = documents.map((d) => d.hexcode);
const documentLocales = Object.keys(documents[0]?.docs ?? {});
if (!documentLocales.includes("en")) throw new Error("documents.json has no English documents; run build");
const otherLocales = (args.locales?.split(",") ?? documentLocales).filter((l) => l !== "en");
const unknown = otherLocales.filter((l) => !documentLocales.includes(l));
if (unknown.length > 0) throw new Error(`no documents for ${unknown.join(", ")} in documents.json`);

try {
  for (const model of models) {
    // A monolingual model gets the shared (English) file only.
    const locales = ["en", ...(model.multilingual ? otherLocales : [])];
    const texts = locales.flatMap((locale) =>
      documents.map((d) => {
        const doc = d.docs[locale] as { title: string; text: string };
        return formatDocument(model, doc.title, doc.text);
      }),
    );
    const started = performance.now();
    const { vectors, stats } = await embedTexts(model, texts, "document", {
      concurrency: Number(args.concurrency),
      onProgress: (n) => process.stdout.write(`\r${model.key}: ${n}/${texts.length}`),
    });
    process.stdout.write("\n");
    const nativeDims = vectors[0]?.length ?? 0;
    if (nativeDims !== model.nativeDims) {
      console.warn(`⚠ ${model.key}: got ${nativeDims} dims, registry says ${model.nativeDims}`);
    }
    for (const dims of [...new Set([nativeDims, ...dimsList])].filter((d) => d <= nativeDims)) {
      locales.forEach((locale, i) => {
        const rows = vectors
          .slice(i * ids.length, (i + 1) * ids.length)
          .map((v) => l2normalize(v.slice(0, dims)));
        const file = vectorFileName(model.key, dims, locale === "en" ? undefined : locale);
        writeFileSync(join(packDir, file), encodeVectors(model.id, ids, rows));
      });
    }
    console.log(
      `embed: ${model.key} (${locales.join(", ")}) ${stats.cached} cached + ${stats.fetched} fetched ` +
        `in ${stats.callMs.length} calls, ${((performance.now() - started) / 1000).toFixed(1)} s`,
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
