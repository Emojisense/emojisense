/**
 * Copy one pack version + the production vector file from packages/data into the Worker.
 *
 *   tsx scripts/sync-pack.ts --model embeddinggemma --dims 256
 *
 * src/generated/   bundled into the Worker (config, locale packs, vectors) — committed
 * public/v1/pack/  static assets served at /v1/pack/<version>/… — generated, not committed
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { decodeVectors, encodeVectors } from "emojisense";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    model: { type: "string", default: "embeddinggemma" },
    dims: { type: "string", default: "256" },
    // Local-only: write an empty vector file when embeddings do not exist yet (alias-only Worker).
    placeholder: { type: "boolean", default: false },
  },
});
const model = getModel(args.model as string);
const dims = Number(args.dims);
const packVersion = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")).packVersion;
const source = join(DATA_ROOT, "dist", "packs", packVersion);
const vectorFile = `vectors.${model.key}.${dims}.bin`;

let vectorBytes: Uint8Array;
if (existsSync(join(source, vectorFile))) {
  vectorBytes = readFileSync(join(source, vectorFile));
} else {
  if (!args.placeholder) throw new Error(`${vectorFile} not found; run the embed step or pass --placeholder`);
  console.warn(`⚠ ${vectorFile} missing: using an empty placeholder (semantic search disabled)`);
  vectorBytes = encodeVectors(model.id, [], []);
}
const index = decodeVectors(vectorBytes);
if (index.model !== model.id || (index.ids.length > 0 && index.dims !== dims)) {
  throw new Error(`${vectorFile} holds ${index.model}@${index.dims}, expected ${model.id}@${dims}`);
}

const workerRoot = new URL("..", import.meta.url).pathname;
const generated = join(workerRoot, "src", "generated");
mkdirSync(generated, { recursive: true });
const PACK_FILES = ["pack.en.json", "pack.en.ext.json", "pack.tr.json", "pack.tr.ext.json"];
for (const file of PACK_FILES) copyFileSync(join(source, file), join(generated, file));
writeFileSync(join(generated, "vectors.bin"), vectorBytes);
writeFileSync(
  join(generated, "config.json"),
  `${JSON.stringify(
    { packVersion, modelKey: model.key, modelId: model.id, dims, queryTemplate: formatQuery(model, "{q}") },
    null,
    2,
  )}\n`,
);

const publicPack = join(workerRoot, "public", "v1", "pack");
rmSync(publicPack, { recursive: true, force: true });
mkdirSync(join(publicPack, packVersion), { recursive: true });
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
const published = [...PACK_FILES, ...(index.ids.length > 0 ? [vectorFile] : [])];
manifest.files = Object.fromEntries(published.map((f) => [f, manifest.files[f]]));
for (const file of published) copyFileSync(join(source, file), join(publicPack, packVersion, file));
writeFileSync(join(publicPack, packVersion, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(workerRoot, "public", "_headers"),
  [
    "/v1/pack/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "  Access-Control-Allow-Origin: *",
    "",
  ].join("\n"),
);
console.log(`sync: pack ${packVersion} + ${model.id}@${dims} → src/generated, public/v1/pack/${packVersion}`);
