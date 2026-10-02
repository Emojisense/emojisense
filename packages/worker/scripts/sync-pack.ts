/**
 * Copy one pack version + the production vector files from packages/data into the Worker.
 *
 *   tsx scripts/sync-pack.ts --model bge-m3 --dims 1024
 *
 * src/generated/   bundled into the Worker (config, locale packs, shared vectors) — committed
 * public/v1/pack/  static assets served at /v1/pack/<version>/… (packs, every vector file; the
 *                  Worker reads the locale vector files from here) — generated, not committed
 * public/p/        layer 2 shards served at /p/<version>/…, if the data package built them
 *                  — generated, not committed
 * public/v1/culture/  culture files served at /v1/culture/<version>/…, built here from the approved
 *                  entries (the `culture:build` step) for yesterday (UTC) + 366 days — generated, not
 *                  committed; cached for an hour, not immutable. Clients check the windows by their
 *                  own day, so the files need no daily rebuild; approving entries needs a sync and
 *                  a deploy. `--culture-date YYYY-MM-DD` picks another first day, `--no-culture`
 *                  publishes none (the API then answers without).
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { addDays, buildCultureFiles } from "@emojisense/data/culture";
import { LOCALE_CODES } from "@emojisense/data/locales";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { vectorFileName } from "@emojisense/data/vector-files";
import { decodeVectors, encodeVectors } from "emojisense";
import { assetHeaders } from "./asset-headers.ts";
import { contentHash } from "./content-hash.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    // The production model (owner decision, 2026-10-02): bge-m3, p95 ≈ 65 ms inside Cloudflare.
    model: { type: "string", default: "bge-m3" },
    dims: { type: "string", default: "1024" },
    // Local-only: write an empty vector file when embeddings do not exist yet (alias-only Worker).
    placeholder: { type: "boolean", default: false },
    culture: { type: "boolean", default: true },
    "culture-date": { type: "string" },
  },
  allowNegative: true,
});
const model = getModel(args.model as string);
const dims = Number(args.dims);
const packVersion = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")).packVersion;
const source = join(DATA_ROOT, "dist", "packs", packVersion);
const vectorFile = vectorFileName(model.key, dims);

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
// Each locale's own vectors (PACK_FORMAT §5): published as static assets, read by the Worker on
// first use. A file from another build (other model, dims or emoji) would mix rankings: refuse it.
const vectorLocales =
  index.ids.length === 0
    ? []
    : LOCALE_CODES.filter((code) => existsSync(join(source, vectorFileName(model.key, dims, code))));
for (const code of vectorLocales) {
  const file = vectorFileName(model.key, dims, code);
  const own = decodeVectors(readFileSync(join(source, file)));
  if (own.model !== model.id || own.dims !== dims || own.ids.join() !== index.ids.join()) {
    throw new Error(`${file} does not match ${vectorFile} (model, dims or emoji); run the embed step again`);
  }
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
const queryTemplate = formatQuery(model, "{q}");
// What a cached search answer depends on besides the request: every locale pack the Worker can
// load, which vector files it has (model, dims, emoji), the model and the built core engine
// (normalization, alias search, fusion). The search cache key holds it, so a data hotfix or a
// ranking change under the same pack version is not answered from the edge cache for a week.
// Vector bytes are left out: they follow the packs' documents, and a dist embedded from another
// cache (or a stale one) would change the key, and empty the edge cache, on every deploy.
const coreDist = dirname(fileURLToPath(import.meta.resolve("emojisense")));
const vectorIdentity = (name: string, vectors: { model: string; dims: number; ids: string[] }) => ({
  name,
  bytes: new TextEncoder().encode(`${vectors.model}@${vectors.dims}\n${vectors.ids.join(" ")}`),
});
const hash = await contentHash([
  ...PACK_FILES.map((file) => ({ name: file, bytes: readFileSync(join(source, file)) })),
  vectorIdentity("vectors.bin", index),
  ...vectorLocales.map((code) => {
    const file = vectorFileName(model.key, dims, code);
    return vectorIdentity(file, decodeVectors(readFileSync(join(source, file))));
  }),
  { name: "model", bytes: new TextEncoder().encode(`${model.id}@${dims}\n${queryTemplate}`) },
  ...readdirSync(coreDist)
    .filter((file) => file.endsWith(".js"))
    .map((file) => ({ name: `core/${file}`, bytes: readFileSync(join(coreDist, file)) })),
]);
const configJson = JSON.stringify(
  { packVersion, modelKey: model.key, modelId: model.id, dims, queryTemplate },
  null,
  2,
);
// The locale list on one line, as Biome formats a short array.
const localeList = vectorLocales.map((code) => JSON.stringify(code)).join(", ");
writeFileSync(
  join(generated, "config.json"),
  `${configJson.replace(/\n}$/, `,\n  "vectorLocales": [${localeList}],\n  "contentHash": "${hash}"\n}`)}\n`,
);

const publicPack = join(workerRoot, "public", "v1", "pack");
rmSync(publicPack, { recursive: true, force: true });
mkdirSync(join(publicPack, packVersion), { recursive: true });
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
const published = [
  ...PACK_FILES,
  ...(index.ids.length > 0 ? [vectorFile] : []),
  ...vectorLocales.map((code) => vectorFileName(model.key, dims, code)),
];
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

// Culture files (PACK_FORMAT §9). The approved entries are built for the next 12 months and
// copied; the SDKs load the same files. Each client checks the windows by its own day (the API by
// the UTC day), so the files stay right without a daily rebuild. They change when a deploy brings
// new entries under the same pack version, so they are cached for an hour, never `immutable`. The
// API reads them through ASSETS (src/culture.ts). A validation error stops the sync: culture:check
// names it. The first day is yesterday (UTC): a device west of UTC may still be on that day.
const publicCulture = join(workerRoot, "public", "v1", "culture");
rmSync(publicCulture, { recursive: true, force: true });
let cultureNote = "no culture files (--no-culture)";
if (args.culture) {
  const from = args["culture-date"] ?? addDays(new Date().toISOString().slice(0, 10), -1);
  const build = buildCultureFiles({ from });
  if (build.packVersion !== packVersion) {
    throw new Error(`culture files are for pack ${build.packVersion}, the Worker serves ${packVersion}`);
  }
  const files = readdirSync(build.outDir).filter((f) => /^culture\.[a-z]{2,3}\.json$|^index\.json$/.test(f));
  mkdirSync(join(publicCulture, packVersion), { recursive: true });
  for (const file of files) copyFileSync(join(build.outDir, file), join(publicCulture, packVersion, file));
  const entries = Object.values(build.locales).reduce((n, l) => n + l.entries, 0);
  cultureNote = `culture ${build.from} → ${build.until} (${build.approved} approved, ${entries} locale entries) → public/v1/culture/${packVersion}`;
}

// Static assets bypass the Worker, so their cache headers live here: immutable for the files
// published above, never for a missing one (asset-headers.ts).
writeFileSync(
  join(workerRoot, "public", "_headers"),
  assetHeaders(packVersion, [...published, "manifest.json"]),
);
console.log(
  `sync: pack ${packVersion} + ${model.id}@${dims} (locale vectors: ${vectorLocales.join(", ") || "none"}; ` +
    `content ${hash}) → src/generated, public/v1/pack/${packVersion}; ${shardNote}; ${cultureNote}`,
);
