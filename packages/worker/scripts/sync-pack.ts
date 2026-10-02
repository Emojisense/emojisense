/**
 * Copy one pack version + the production vector file from packages/data into the Worker.
 *
 *   tsx scripts/sync-pack.ts --model bge-m3 --dims 1024
 *
 * src/generated/   bundled into the Worker (config, locale packs, vectors) — committed
 * public/v1/pack/  static assets served at /v1/pack/<version>/… — generated, not committed
 * public/p/        layer 2 shards served at /p/<version>/…, if the data package built them
 *                  — generated, not committed
 * public/v1/culture/  culture files served at /v1/culture/<version>/…, if `culture:build` ran
 *                  — generated, not committed; cached for an hour, not immutable
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LOCALE_CODES } from "@emojisense/data/locales";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { decodeVectors, encodeVectors } from "emojisense";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    // The production model (owner decision, 2026-10-02): bge-m3, p95 ≈ 65 ms inside Cloudflare.
    model: { type: "string", default: "bge-m3" },
    dims: { type: "string", default: "1024" },
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
// Every locale pack the data step produced (core + ext); the Worker bundles only BUNDLED_LOCALES.
const PACK_FILES = readdirSync(source).filter((f) => /^pack\.[a-z]{2}(\.ext)?\.json$/.test(f));
// The API accepts every locale of @emojisense/data/locales and reads the core packs it does not
// bundle from these static assets (src/locale-engines.ts), so each one must be published.
const unpublished = LOCALE_CODES.filter((code) => !PACK_FILES.includes(`pack.${code}.json`));
if (unpublished.length > 0) throw new Error(`no core pack for ${unpublished.join(", ")} in ${source}`);
// The Worker bundles English and Turkish for server-side hybrid search; all locales are static assets.
const BUNDLED = ["pack.en.json", "pack.en.ext.json", "pack.tr.json", "pack.tr.ext.json"];
for (const file of BUNDLED) copyFileSync(join(source, file), join(generated, file));
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

// Layer 2 shards (PACK_FORMAT §6). They are valid only for the model they were computed with, so
// shards of another model are skipped: clients then fall back to the API instead of mixing models.
const modelTag = `${model.key}@${dims}`;
const shardSource = join(DATA_ROOT, "dist", "shards", packVersion);
const publicShards = join(workerRoot, "public", "p");
rmSync(publicShards, { recursive: true, force: true });
let shardNote = "no shards";
if (existsSync(join(shardSource, "index.json"))) {
  const shardIndex = JSON.parse(readFileSync(join(shardSource, "index.json"), "utf8"));
  if (shardIndex.packVersion !== packVersion || shardIndex.model !== modelTag) {
    console.warn(
      `⚠ shards are for ${shardIndex.packVersion}/${shardIndex.model}, the Worker serves ${packVersion}/${modelTag}: not copied`,
    );
  } else {
    cpSync(shardSource, join(publicShards, packVersion), { recursive: true });
    shardNote = `${shardIndex.keys?.length ?? 0} shards → public/p/${packVersion}`;
  }
}

// Culture files (PACK_FORMAT §8). They are rebuilt daily under the same pack version, so they are
// cached for an hour, never `immutable`. Files of another pack version are not copied.
const cultureSource = join(DATA_ROOT, "dist", "culture", packVersion);
const publicCulture = join(workerRoot, "public", "v1", "culture");
rmSync(publicCulture, { recursive: true, force: true });
let cultureNote = "no culture files";
if (existsSync(join(cultureSource, "index.json"))) {
  const cultureIndex = JSON.parse(readFileSync(join(cultureSource, "index.json"), "utf8"));
  const files = readdirSync(cultureSource).filter((f) => /^culture\.[a-z]{2,3}\.json$|^index\.json$/.test(f));
  mkdirSync(join(publicCulture, packVersion), { recursive: true });
  for (const file of files) copyFileSync(join(cultureSource, file), join(publicCulture, packVersion, file));
  cultureNote = `culture ${cultureIndex.from} → ${cultureIndex.until} → public/v1/culture/${packVersion}`;
}

// Static assets bypass the Worker, so their cache headers live here. `_headers` does not apply
// to Worker responses (wrangler.jsonc keeps /v1/pack/*, /v1/culture/* and /p/* out of
// run_worker_first).
const cors = "  Access-Control-Allow-Origin: *";
const immutable = ["  Cache-Control: public, max-age=31536000, immutable", cors];
const hourly = ["  Cache-Control: public, max-age=3600", cors];
writeFileSync(
  join(workerRoot, "public", "_headers"),
  ["/v1/pack/*", ...immutable, "/p/*", ...immutable, "/v1/culture/*", ...hourly, ""].join("\n"),
);
console.log(
  `sync: pack ${packVersion} + ${model.id}@${dims} → src/generated, public/v1/pack/${packVersion}; ${shardNote}; ${cultureNote}`,
);
