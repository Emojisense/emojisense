/**
 * Copy one pack version + the production vector file from packages/data into the Worker.
 *
 *   tsx scripts/sync-pack.ts --model embeddinggemma --dims 256
 *
 * src/generated/   bundled into the Worker (config, locale packs, vectors) — committed
 * public/v1/pack/  static assets served at /v1/pack/<version>/… — generated, not committed
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { decodeVectors } from "emojisense";

const { values: args } = parseArgs({
  options: { model: { type: "string", default: "embeddinggemma" }, dims: { type: "string", default: "256" } },
});
const model = getModel(args.model as string);
const dims = Number(args.dims);
const packVersion = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")).packVersion;
const source = join(DATA_ROOT, "dist", "packs", packVersion);
const vectorFile = `vectors.${model.key}.${dims}.bin`;

const index = decodeVectors(readFileSync(join(source, vectorFile)));
if (index.model !== model.id || index.dims !== dims) {
  throw new Error(`${vectorFile} holds ${index.model}@${index.dims}, expected ${model.id}@${dims}`);
}

const workerRoot = new URL("..", import.meta.url).pathname;
const generated = join(workerRoot, "src", "generated");
mkdirSync(generated, { recursive: true });
for (const file of ["pack.en.json", "pack.tr.json"]) copyFileSync(join(source, file), join(generated, file));
copyFileSync(join(source, vectorFile), join(generated, "vectors.bin"));
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
const published = ["pack.en.json", "pack.tr.json", vectorFile];
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
