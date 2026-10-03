/**
 * Layer 2, base layer (PACK_FORMAT.md §6): synthetic queries from our own data for every pack
 * locale, resolved like the API's answers in that locale → dist/shards-base/<packVersion>/:
 *
 *   f/<hash>.json   shard files and one base index per locale, named by content
 *   base.json       manifest: locale → its base index
 *
 *   tsx src/build-base-shards.ts [--locales en,tr] [--min-count 5] [--max-queries 200000]
 *     [--results 24] [--max-kb 30] [--resolver workers-ai|cached|fake] [--no-reuse]
 *
 * Then publish it with upload-shards.ts. The nightly build names each locale's base index in its
 * live index and leaves out the queries the base holds. Entries of the previous base build with
 * the same model are reused, so a rebuild embeds only new queries. Resolvers as in
 * build-shards.ts; EMOJISENSE_LOCAL_EMBED=1 embeds with scripts/local_embed_server.py.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { createEngine, type Pack } from "emojisense";
import { decodeVectors, type VectorIndex } from "emojisense/vectors";
import { readPackConfig } from "./config.ts";
import { disposeEmbeddings } from "./embeddings.ts";
import { LOCALE_CODES } from "./locales.ts";
import { getModel } from "./models.ts";
import { BASE_FILE, BUILD_DIR, DATA_ROOT } from "./paths.ts";
import { semanticBonus } from "./semantic-score.ts";
import { bootstrapQueries } from "./shards/bootstrap.ts";
import { buildShards } from "./shards/build.ts";
import { cachedEmbedder, workersAiEmbedder } from "./shards/embedders.ts";
import { gzipBytes } from "./shards/files.ts";
import {
  BASE_MANIFEST_FILE,
  contentFile,
  hashLayer,
  type PublishedFile,
  resolveFrom,
  SHARD_FILES_DIR,
  type ShardBaseManifest,
} from "./shards/publish.ts";
import { aggregateQueries, createWorkerGate } from "./shards/queries.ts";
import { createFakeResolver, createVectorResolver } from "./shards/resolvers.ts";
import type { ResultStore } from "./shards/store.ts";
import type { Shard, ShardIndex, ShardResolver } from "./shards/types.ts";
import type { BaseEmoji } from "./types.ts";
import { glyphVectorFileName, vectorFileName } from "./vector-files.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    locales: { type: "string" },
    "min-count": { type: "string", default: "5" },
    "max-queries": { type: "string", default: "200000" },
    results: { type: "string", default: "24" },
    "max-kb": { type: "string", default: "30" },
    resolver: { type: "string", default: "workers-ai" },
    "no-reuse": { type: "boolean", default: false },
  },
});

const minCount = Number(args["min-count"]);
const resultsPerQuery = Number(args.results);
const locales = args.locales ? args.locales.split(",").map((l) => l.trim()) : LOCALE_CODES;
const unknown = locales.filter((l) => !LOCALE_CODES.includes(l));
if (unknown.length > 0) {
  console.error(`build-base-shards: unknown locale(s) ${unknown.join(", ")}`);
  process.exit(2);
}
const config = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`build-base-shards: no pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const readVectors = (file: string): VectorIndex | undefined => {
  const path = join(packDir, file);
  return existsSync(path) ? decodeVectors(readFileSync(path)) : undefined;
};

const fake = args.resolver === "fake";
if (!fake && args.resolver !== "workers-ai" && args.resolver !== "cached") {
  console.error(`build-base-shards: unknown resolver "${args.resolver}"`);
  process.exit(2);
}
const model = getModel(config.model.key);
const dims = config.model.dims;
const shared = readVectors(vectorFileName(model.key, dims));
if (!fake && (!shared || shared.model !== model.id || shared.dims !== dims)) {
  console.error(`build-base-shards: ${vectorFileName(model.key, dims)} must hold ${model.id}@${dims}`);
  process.exit(2);
}
const glyph = readVectors(glyphVectorFileName(model.key, dims));
const embedder = args.resolver === "cached" ? cachedEmbedder(model) : workersAiEmbedder(model);

// Stand-in results must never land where an upload picks up real shards.
const outDir = join(DATA_ROOT, "dist", fake ? "shards-base-fake" : "shards-base", config.packVersion);
const readOut = <T>(path: string): T | undefined =>
  existsSync(join(outDir, path)) ? (JSON.parse(readFileSync(join(outDir, path), "utf8")) as T) : undefined;
const previous = args["no-reuse"] ? undefined : readOut<ShardBaseManifest>(BASE_MANIFEST_FILE);

/** The entries of the previous base build of a locale that `wanted` holds, when its model matches. */
function reusePrevious(
  locale: string,
  resolver: ShardResolver,
  wanted: ReadonlySet<string>,
  store: ResultStore,
) {
  const indexPath = previous?.model === resolver.model ? previous.locales[locale] : undefined;
  const index = indexPath ? readOut<ShardIndex>(indexPath) : undefined;
  let reused = 0;
  for (const file of Object.values(index?.files ?? {})) {
    const shard = readOut<Shard>(resolveFrom(SHARD_FILES_DIR, file));
    for (const [q, results] of Object.entries(shard?.entries ?? {})) {
      if (!wanted.has(q) || results.length < resultsPerQuery) continue;
      store.set(q, results.slice(0, resultsPerQuery));
      reused++;
    }
  }
  return reused;
}

const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
const validated = JSON.parse(readFileSync(join(BUILD_DIR, "validated.json"), "utf8"));
const files = new Map<string, PublishedFile>();
const manifestLocales: Record<string, string> = {};
let modelTag = fake ? "fake@0" : `${model.key}@${dims}`;
const started = performance.now();

try {
  for (const locale of locales) {
    // What a client of this locale has: English and the locale, core parts first, then ext.
    const names = locale === "en" ? ["en", "en.ext"] : ["en", locale, "en.ext", `${locale}.ext`];
    const packs = names.map(readPack);
    const full = createEngine(packs);
    const core = createEngine(packs.filter((_, i) => !names[i]?.endsWith(".ext")));
    const own = locale === "en" ? undefined : readVectors(vectorFileName(model.key, dims, locale));
    const resolver = fake
      ? createFakeResolver(full.entries)
      : createVectorResolver({
          tag: modelTag,
          index: own ? [shared as VectorIndex, own] : (shared as VectorIndex),
          // The API's semantic score: popularity prior and glyph term (semantic-score.ts).
          bonus: (query) => semanticBonus(full.popularity, glyph, query),
          emojiOf: (id) => full.get(id)?.emoji,
          embedder,
        });
    modelTag = resolver.model;

    const queries = aggregateQueries(bootstrapQueries(emoji, validated, minCount, [locale]), {
      minCount,
      maxQueries: Number(args["max-queries"]),
    });
    const built = await buildShards({
      queries,
      reachesWorker: createWorkerGate([full, core]),
      resolver,
      packVersion: config.packVersion,
      resultsPerQuery,
      maxShardBytes: Number(args["max-kb"]) * 1024,
      shardBytes: gzipBytes,
      previous: (wanted, store) => reusePrevious(locale, resolver, wanted, store),
      onProgress: (done, total) => {
        if (process.stdout.isTTY)
          process.stdout.write(`\r${locale}: resolve ${done}/${total}${done === total ? "\n" : ""}`);
      },
    });
    const layer = await hashLayer(built, SHARD_FILES_DIR);
    const index = await contentFile(JSON.stringify(layer.index));
    for (const file of [...layer.files, index]) files.set(file.path, file);
    manifestLocales[locale] = index.path;
    const { stats } = built;
    console.log(
      `${locale}: ${stats.queries} queries, ${stats.answeredOnDevice} answered on device, ` +
        `${stats.reused} reused, ${stats.resolved} resolved, ${stats.unresolved} unresolved → ` +
        `${built.store.size} entries in ${stats.shards} shards` +
        (stats.oversized.length ? ` (⚠ over budget: ${stats.oversized.join(", ")})` : ""),
    );
  }

  const manifest: ShardBaseManifest = {
    format: "emojisense-shard-base",
    formatVersion: 1,
    packVersion: config.packVersion,
    model: modelTag,
    locales: manifestLocales,
  };
  // Written after every locale is built: the previous build was read for reuse until now.
  rmSync(outDir, { recursive: true, force: true });
  for (const file of files.values()) {
    mkdirSync(dirname(join(outDir, file.path)), { recursive: true });
    writeFileSync(join(outDir, file.path), file.json);
  }
  writeFileSync(join(outDir, BASE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  const gzip = [...files.values()].reduce((sum, file) => sum + gzipBytes(file.json), 0);
  console.log(
    `base: ${locales.length} locales, ${files.size} files, ${(gzip / 1024 / 1024).toFixed(1)} MB gzip, ` +
      `model ${modelTag} → ${outDir} in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
} finally {
  await disposeEmbeddings();
}
