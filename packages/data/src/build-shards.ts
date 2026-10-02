/**
 * Layer 2: precompute semantic results for frequent queries → dist/shards/<packVersion>/
 * (PACK_FORMAT.md §6). Run nightly with the analytics export, or once with --bootstrap.
 *
 *   tsx src/build-shards.ts --log queries.jsonl        rows: {"q": "...", "n": 12[, "locale": "tr"]}
 *   tsx src/build-shards.ts --bootstrap                synthetic day-one queries (README.md)
 *     [--min-count 5] [--max-queries 1000000] [--results 24] [--max-kb 30]
 *     [--resolver workers-ai|cached|fake] [--model bge-m3] [--dims 1024] [--out DIR] [--no-reuse]
 *
 * --model and --dims default to pack.config.json → model (the production model).
 *
 * Resolvers: workers-ai embeds with Workers AI (needs `wrangler login`); cached uses only
 * embeddings already in .cache (offline); fake writes stand-in results to dist/shards-fake/ for
 * dry runs. Entries of the previous build with the same model and pack version are reused.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type AliasEngine, createEngine, type Pack } from "emojisense";
import { decodeVectors } from "emojisense/vectors";
import { readPackConfig } from "./config.ts";
import { disposeEmbeddings } from "./embeddings.ts";
import { getModel } from "./models.ts";
import { BASE_FILE, BUILD_DIR, DATA_ROOT } from "./paths.ts";
import { semanticBonus } from "./semantic-score.ts";
import { bootstrapQueries } from "./shards/bootstrap.ts";
import { buildShards } from "./shards/build.ts";
import { cachedEmbedder, workersAiEmbedder } from "./shards/embedders.ts";
import { gzipBytes, loadShardEntries, readShardIndex, writeShardDir } from "./shards/files.ts";
import { aggregateQueries, createWorkerGate, parseQueryLog, type QueryLogRow } from "./shards/queries.ts";
import { createFakeResolver, createVectorResolver } from "./shards/resolvers.ts";
import type { ShardResolver } from "./shards/types.ts";
import type { BaseEmoji } from "./types.ts";
import { glyphVectorFileName } from "./vector-files.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    log: { type: "string" },
    bootstrap: { type: "boolean", default: false },
    "min-count": { type: "string", default: "5" },
    "max-queries": { type: "string", default: "1000000" },
    results: { type: "string", default: "24" },
    "max-kb": { type: "string", default: "30" },
    resolver: { type: "string", default: "workers-ai" },
    model: { type: "string" },
    dims: { type: "string" },
    out: { type: "string" },
    "no-reuse": { type: "boolean", default: false },
  },
});

if (!args.log && !args.bootstrap) {
  console.error("build-shards: pass --log <queries.jsonl> and/or --bootstrap");
  process.exit(2);
}
const minCount = Number(args["min-count"]);
const resultsPerQuery = Number(args.results);
const config = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`build-shards: no pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const [en, tr, enExt, trExt] = ["en", "tr", "en.ext", "tr.ext"].map(readPack) as Pack[];
// Core parts first, then ext (PACK_FORMAT.md §2): the order a client indexes them.
const fullEngine = createEngine([en, tr, enExt, trExt] as Pack[]);
const engines: AliasEngine[] = [fullEngine, createEngine([en, tr] as Pack[])];

// ── Queries ─────────────────────────────────────────────────────────────────────────────────
// concat, not push(...rows): a 1M-row log would overflow the argument stack.
let rows: QueryLogRow[] = [];
if (args.log) rows = rows.concat(parseQueryLog(readFileSync(args.log, "utf8")));
if (args.bootstrap) {
  const { emoji }: { emoji: BaseEmoji[] } = JSON.parse(readFileSync(BASE_FILE, "utf8"));
  const validated = JSON.parse(readFileSync(join(BUILD_DIR, "validated.json"), "utf8"));
  rows = rows.concat(bootstrapQueries(emoji, validated, minCount));
}
const queries = aggregateQueries(rows, { minCount, maxQueries: Number(args["max-queries"]) });

// ── Resolver ────────────────────────────────────────────────────────────────────────────────
function createResolver(kind: string): ShardResolver {
  if (kind === "fake") return createFakeResolver(fullEngine.entries);
  if (kind !== "workers-ai" && kind !== "cached") throw new Error(`unknown resolver "${kind}"`);
  const model = getModel(args.model ?? config.model.key);
  const dims = Number(args.dims ?? config.model.dims);
  const file = join(packDir, `vectors.${model.key}.${dims}.bin`);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing. Run: pnpm --filter @emojisense/data embed --models ${model.key}`);
  }
  const index = decodeVectors(readFileSync(file));
  if (index.model !== model.id || index.dims !== dims) {
    throw new Error(`${file} holds ${index.model}@${index.dims}, expected ${model.id}@${dims}`);
  }
  const glyphFile = join(packDir, glyphVectorFileName(model.key, dims));
  const glyph = existsSync(glyphFile) ? decodeVectors(readFileSync(glyphFile)) : undefined;
  return createVectorResolver({
    tag: `${model.key}@${dims}`,
    index,
    // The API's semantic score: popularity prior and glyph term (semantic-score.ts).
    bonus: (query) => semanticBonus(fullEngine.popularity, glyph, query),
    emojiOf: (id) => fullEngine.get(id)?.emoji,
    embedder: kind === "cached" ? cachedEmbedder(model) : workersAiEmbedder(model),
  });
}
const resolver = createResolver(args.resolver as string);
// Stand-in results must never land where the Worker sync picks up real shards.
const outDir =
  args.out ??
  join(DATA_ROOT, "dist", args.resolver === "fake" ? "shards-fake" : "shards", config.packVersion);
const previousIndex = args["no-reuse"] ? undefined : readShardIndex(outDir);
const reusable = previousIndex?.model === resolver.model && previousIndex.packVersion === config.packVersion;

// ── Build ───────────────────────────────────────────────────────────────────────────────────
const started = performance.now();
try {
  const built = await buildShards({
    queries,
    reachesWorker: createWorkerGate(engines),
    resolver,
    packVersion: config.packVersion,
    resultsPerQuery,
    maxShardBytes: Number(args["max-kb"]) * 1024,
    shardBytes: gzipBytes,
    ...(reusable
      ? { previous: (wanted, store) => loadShardEntries(outDir, wanted, resultsPerQuery, store) }
      : {}),
    onProgress: (done, total) => {
      if (process.stdout.isTTY)
        process.stdout.write(`\rresolve: ${done}/${total}${done === total ? "\n" : ""}`);
    },
  });
  const { gzip } = writeShardDir(outDir, built.index, built.plans, built.store);

  const { stats } = built;
  const sorted = [...gzip].sort((a, b) => a - b);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const longest = built.index.keys.reduce((a, k) => (k.length > a.length ? k : a), "");
  console.log(
    [
      `shards: ${rows.length} input rows → ${stats.queries} queries seen ≥ ${minCount}×`,
      `  ${stats.answeredOnDevice} answered on device (dropped), ${stats.reused} reused, ` +
        `${stats.resolved} resolved, ${stats.unresolved} unresolved (stay on the API)`,
      `  ${stats.shards} shards, gz p50 ${kb(pick(0.5))}, p95 ${kb(pick(0.95))}, max ${kb(pick(1))}, ` +
        `total ${kb(gzip.reduce((a, b) => a + b, 0))}; longest key "${longest}"`,
      ...(stats.oversized.length ? [`  ⚠ over budget (key cannot grow): ${stats.oversized.join(", ")}`] : []),
      `  model ${resolver.model} → ${outDir} in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    ].join("\n"),
  );
} finally {
  await disposeEmbeddings();
}
