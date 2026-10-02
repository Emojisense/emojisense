import {
  buildShards,
  createResultStore,
  createWorkerGate,
  type ResultStore,
  type ShardResolver,
  type ShardResult,
} from "@emojisense/data/shards";
import { dayOf } from "@emojisense/platform";
import { embeddingText, type VectorIndex } from "emojisense";
import {
  SEARCH_DEFAULT_LIMIT,
  SHARD_MAX_EMBEDDINGS,
  SHARD_MAX_QUERIES,
  SHARD_MAX_RAW_BYTES,
  SHARD_MIN_ACCOUNTS,
  SHARD_MIN_SEARCHES,
  SHARD_STALE_DAYS,
  SHARD_WINDOW_DAYS,
  SHARD_WRITE_CONCURRENCY,
} from "../config.ts";
import type { Env } from "../env.ts";
import { type Catalog, embedTexts, modelTag, semanticResults } from "../semantic.ts";
import { selectCandidates, selectionWindow } from "./select.ts";
import {
  buildId,
  loadBuild,
  pruneBuilds,
  pruneStaleStores,
  readPointer,
  type ShardBucket,
  type ShardPointer,
  storePrefix,
  writeBuild,
  writePointer,
} from "./storage.ts";

export interface ShardLimits {
  minAccounts: number;
  minSearches: number;
  windowDays: number;
  maxQueries: number;
  /** New embeddings per run; the rest wait for the next run. */
  maxEmbeddings: number;
  /** Raw JSON bytes per shard file. */
  maxShardBytes: number;
  /** Results per query: the API's default `limit`. */
  results: number;
  staleDays: number;
}

export const SHARD_LIMITS: ShardLimits = {
  minAccounts: SHARD_MIN_ACCOUNTS,
  minSearches: SHARD_MIN_SEARCHES,
  windowDays: SHARD_WINDOW_DAYS,
  maxQueries: SHARD_MAX_QUERIES,
  maxEmbeddings: SHARD_MAX_EMBEDDINGS,
  maxShardBytes: SHARD_MAX_RAW_BYTES,
  results: SEARCH_DEFAULT_LIMIT,
  staleDays: SHARD_STALE_DAYS,
};

/** The locales of the bundled alias engine: a query stays when a client of either would ask. */
const GATE_LOCALES = ["en", "tr"];

export interface ShardRunReport {
  /** published: a new build is served. unchanged: the same build again. empty: nothing to publish. */
  status: "published" | "unchanged" | "empty" | "skipped";
  reason?: string;
  build?: string;
  /** Queries over both thresholds that may be published. */
  candidates: number;
  /** Queries over both thresholds that look personal (privacyReason). */
  privacyDropped: number;
  /** Candidates the bundled alias engine answers with confidence, so no client asks for them. */
  answeredOnDevice: number;
  reused: number;
  embedded: number;
  /** Left for the next run by the embedding cap. */
  deferred: number;
  /** Embeddings lost to failed Workers AI calls; those queries are tried again next run. */
  failed: number;
  queries: number;
  shards: number;
  bytes: number;
  pruned: number;
}

interface Budget {
  remaining: number;
  embedded: number;
  deferred: number;
  failed: number;
  calls: number;
  failedCalls: number;
}

/**
 * The API's `GET /v1/search?mode=semantic&locale=en` for many queries: the same embedded text
 * (`embeddingText`, the model template), vectors and rounding (semantic.ts), one Workers AI call
 * per batch. Stops embedding when the budget is spent.
 */
function apiResolver(
  env: Env,
  catalog: Catalog,
  indexes: readonly VectorIndex[],
  budget: Budget,
): ShardResolver {
  return {
    model: modelTag(catalog),
    async resolve(queries, limit) {
      const out = new Map<string, ShardResult[]>();
      const allowed = queries.slice(0, Math.max(0, budget.remaining));
      budget.deferred += queries.length - allowed.length;
      if (allowed.length === 0) return out;
      budget.remaining -= allowed.length;
      budget.calls++;
      try {
        const vectors = await embedTexts(
          env,
          catalog,
          allowed.map((q) => embeddingText(q)),
        );
        const engine = catalog.engine();
        allowed.forEach((q, i) => {
          const results = semanticResults(engine, indexes, vectors[i] as Float32Array, limit);
          out.set(
            q,
            results.map((r): ShardResult => [r.emoji, r.id, r.score]),
          );
        });
        budget.embedded += allowed.length;
      } catch (error) {
        budget.failed += allowed.length;
        budget.failedCalls++;
        console.warn(JSON.stringify({ event: "shards_embed_failed", error: (error as Error).name }));
      }
      return out;
    },
  };
}

/** Copies the served build's entries of the wanted queries, cut to `limit` results. */
function reuse(prior: ResultStore, wanted: ReadonlySet<string>, store: ResultStore, limit: number): number {
  let copied = 0;
  for (const q of wanted) {
    const results = prior.get(q);
    if (!results) continue;
    store.set(q, results.slice(0, limit));
    copied++;
  }
  return copied;
}

const report = (status: ShardRunReport["status"], fields: Partial<ShardRunReport> = {}): ShardRunReport => ({
  status,
  candidates: 0,
  privacyDropped: 0,
  answeredOnDevice: 0,
  reused: 0,
  embedded: 0,
  deferred: 0,
  failed: 0,
  queries: 0,
  shards: 0,
  bytes: 0,
  pruned: 0,
  ...fields,
});

/**
 * The nightly layer-2 build (DECISIONS.md, "Nightly shard build"): query_daily over the window →
 * k-anonymity and privacy filters → drop what the device answers → reuse the served build's
 * entries, embed the new queries (capped) → adaptive split → R2 → pointer. Running it again on
 * the same day publishes the same build. Logs counts only, never query text.
 */
export async function runShardBuild(
  env: Env,
  catalog: Catalog,
  options: { now: number; limits?: Partial<ShardLimits> },
): Promise<ShardRunReport> {
  const started = Date.now();
  const limits = { ...SHARD_LIMITS, ...options.limits };
  const skip = (reason: string) => {
    console.log(JSON.stringify({ event: "shards_skipped", reason }));
    return report("skipped", { reason });
  };
  if (env.SHARDS_CRON_ENABLED !== "true") return skip("disabled");
  if (!env.DB) return skip("no database");
  if (!env.SHARDS) return skip("no bucket");
  if (!env.AI) return skip("no Workers AI");

  try {
    const bucket: ShardBucket = env.SHARDS;
    const { config } = catalog;
    const prefix = storePrefix(config.packVersion, config.contentHash);
    const window = selectionWindow(options.now, limits.windowDays);
    const selection = await selectCandidates(env.DB, window, limits);

    const served = await readPointer(bucket, prefix);
    const prior = createResultStore();
    const reusable = served && served.model === modelTag(catalog) && served.results >= limits.results;
    if (reusable) await loadBuild(bucket, prefix, served.build, prior, SHARD_WRITE_CONCURRENCY);

    // Shards hold the `locale=en` answers: the shared vectors only (PACK_FORMAT §6).
    const { indexes } = await catalog.vectors("en", env);
    const budget: Budget = {
      remaining: limits.maxEmbeddings,
      embedded: 0,
      deferred: 0,
      failed: 0,
      calls: 0,
      failedCalls: 0,
    };
    const built = await buildShards({
      queries: selection.candidates.map((c) => ({ q: c.q, n: c.searches, locales: GATE_LOCALES })),
      reachesWorker: createWorkerGate([catalog.engine()]),
      resolver: apiResolver(env, catalog, indexes, budget),
      packVersion: config.packVersion,
      resultsPerQuery: limits.results,
      maxShardBytes: limits.maxShardBytes,
      batchSize: catalog.model.maxBatch,
      previous: (wanted, store) => reuse(prior, wanted, store, limits.results),
    });
    const counts = {
      candidates: selection.candidates.length,
      privacyDropped: selection.privacyDropped,
      answeredOnDevice: built.stats.answeredOnDevice,
      reused: built.stats.reused,
      embedded: budget.embedded,
      deferred: budget.deferred,
      failed: budget.failed,
      queries: built.store.size,
      shards: built.plans.length,
    };
    if (budget.calls > 0 && budget.failedCalls === budget.calls) {
      // Workers AI is down: keep serving the current build rather than a smaller one.
      throw new Error("every Workers AI call failed");
    }
    if (built.store.size === 0) {
      console.log(JSON.stringify({ event: "shards_empty", ...counts, ms: Date.now() - started }));
      return report("empty", counts);
    }

    const build = await buildId(built);
    const unchanged = served?.build === build;
    const bytes = unchanged ? 0 : await writeBuild(bucket, prefix, build, built, SHARD_WRITE_CONCURRENCY);
    const pointer: ShardPointer = {
      format: "emojisense-shard-pointer",
      formatVersion: 1,
      build,
      previous: unchanged ? (served?.previous ?? null) : (served?.build ?? null),
      model: built.index.model,
      results: limits.results,
      queries: built.store.size,
      shards: built.plans.length,
      window,
      checkedDay: dayOf(options.now),
    };
    // Written last: until now every isolate serves the previous build, which is complete.
    await writePointer(bucket, prefix, pointer);
    const keep = new Set([build, ...(pointer.previous ? [pointer.previous] : [])]);
    const pruned =
      (await pruneBuilds(bucket, prefix, keep)) +
      (await pruneStaleStores(bucket, prefix, options.now, limits.staleDays));

    const status = unchanged ? "unchanged" : "published";
    console.log(
      JSON.stringify({
        event: "shards_built",
        status,
        build,
        ...counts,
        bytes,
        pruned,
        ms: Date.now() - started,
      }),
    );
    return report(status, { build, ...counts, bytes, pruned });
  } catch (error) {
    console.error(JSON.stringify({ event: "shards_build_failed", error: (error as Error).name }));
    // Rethrown so the cron run is marked as failed in the Cloudflare dashboard.
    throw error;
  }
}
