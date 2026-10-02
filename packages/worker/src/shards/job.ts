import {
  buildShards,
  createResultStore,
  createWorkerGate,
  type QueryCount,
  type ResultStore,
  type ShardResolver,
  type ShardResult,
} from "@emojisense/data/shards";
import { dayOf, SHARD_MIN_ACCOUNTS, SHARD_MIN_SEARCHES, SHARD_WINDOW_DAYS } from "@emojisense/platform";
import { embeddingText } from "emojisense";
import type { VectorIndex } from "emojisense/vectors";
import {
  SEARCH_DEFAULT_LIMIT,
  SHARD_MAX_EMBEDDINGS,
  SHARD_MAX_QUERIES,
  SHARD_MAX_RAW_BYTES,
  SHARD_STALE_DAYS,
  SHARD_WRITE_CONCURRENCY,
} from "../config.ts";
import type { Env } from "../env.ts";
import { type Catalog, embedTexts, modelTag, semanticResults } from "../semantic.ts";
import { type Candidate, selectCandidates, selectionWindow } from "./select.ts";
import {
  buildId,
  type LocaleShards,
  loadBuild,
  localeDir,
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
  /** Queries per build, over every locale. */
  maxQueries: number;
  /** New embeddings per run, over every locale; the rest wait for the next run. */
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

/** English: its files stay at the build root, which clients from before locale shards read. */
const ROOT_LOCALE = "en";

export interface ShardRunReport {
  /** published: a new build is served. unchanged: the same build again. empty: no build yet, none made. */
  status: "published" | "unchanged" | "empty" | "skipped";
  reason?: string;
  build?: string;
  /** Queries over both thresholds (per locale) that may be published. */
  candidates: number;
  /** Queries over both thresholds that look personal (privacyReason). */
  privacyDropped: number;
  /** Candidates their locale's alias engine answers with confidence, so no client asks for them. */
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
  /** Queries and shard files per locale directory of the build. */
  locales: Record<string, { queries: number; shards: number }>;
  /** Locales with candidates whose alias engine could not be loaded: no directory this run. */
  skippedLocales: string[];
}

interface Budget {
  embedded: number;
  failed: number;
  calls: number;
  failedCalls: number;
}

/** One locale's part of the run: what reaches the API there, and its entries in the served build. */
interface LocalePlan {
  locale: string;
  kept: QueryCount[];
  answeredOnDevice: number;
  prior: ResultStore;
}

/**
 * The API's `GET /v1/search?mode=semantic&locale=<locale>` for many queries: the same embedded
 * text (`embeddingText`, the model template), the locale's vectors (shared and its own), the same
 * rounding (semantic.ts), one Workers AI call per batch. It embeds only the queries the run's
 * budget allows for this locale; `indexes` undefined (the locale's vector file did not load)
 * embeds none, so those queries wait for the next run.
 */
function apiResolver(
  env: Env,
  catalog: Catalog,
  indexes: readonly VectorIndex[] | undefined,
  allowed: ReadonlySet<string>,
  budget: Budget,
): ShardResolver {
  return {
    model: modelTag(catalog),
    async resolve(queries, limit) {
      const out = new Map<string, ShardResult[]>();
      const chosen = indexes ? queries.filter((q) => allowed.has(q)) : [];
      if (!indexes || chosen.length === 0) return out;
      budget.calls++;
      try {
        const vectors = await embedTexts(
          env,
          catalog,
          chosen.map((q) => embeddingText(q)),
        );
        const engine = catalog.engine();
        chosen.forEach((q, i) => {
          const vector = vectors[i] as Float32Array;
          const results = semanticResults(engine, indexes, vector, limit, catalog.glyph?.());
          out.set(
            q,
            results.map((r): ShardResult => [r.emoji, r.id, r.score]),
          );
        });
        budget.embedded += chosen.length;
      } catch (error) {
        budget.failed += chosen.length;
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

/** Candidates per locale, English first, then in the order of each locale's most searched query. */
function byLocale(candidates: readonly Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>([[ROOT_LOCALE, []]]);
  for (const candidate of candidates) {
    const group = groups.get(candidate.locale);
    if (group) group.push(candidate);
    else groups.set(candidate.locale, [candidate]);
  }
  return groups;
}

/**
 * Which new queries the run embeds: the most searched over every locale, up to `max`, so a busy
 * locale cannot keep the others waiting for longer than its share of searches.
 */
function allowEmbeddings(plans: readonly LocalePlan[], max: number) {
  const todo = plans.flatMap((plan) =>
    plan.kept.filter((q) => !plan.prior.has(q.q)).map((q) => ({ locale: plan.locale, q: q.q, n: q.n })),
  );
  todo.sort((a, b) => b.n - a.n || compare(a.locale, b.locale) || compare(a.q, b.q));
  const allowed = new Map(plans.map((plan) => [plan.locale, new Set<string>()]));
  for (const { locale, q } of todo.slice(0, max)) allowed.get(locale)?.add(q);
  return { allowed, deferred: Math.max(0, todo.length - max) };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
  locales: {},
  skippedLocales: [],
  ...fields,
});

/**
 * The nightly layer-2 build (DECISIONS.md, "Nightly shard build" and "Shards per locale"):
 * query_daily over the window → k-anonymity per locale and privacy filters → drop what each
 * locale's device answers → reuse the served build's entries, embed the new queries (one budget
 * over every locale, most searched first) → adaptive split per locale → R2 → pointer. English
 * stays at the build root (older clients read it), every other locale gets its own directory.
 * Running it again on the same day publishes the same build. Logs counts only, never query text.
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
    const reusable = served && served.model === modelTag(catalog) && served.results >= limits.results;

    const plans: LocalePlan[] = [];
    const skippedLocales: string[] = [];
    for (const [locale, candidates] of byLocale(selection.candidates)) {
      const queries = candidates.map((c): QueryCount => ({ q: c.q, n: c.searches, locales: [locale] }));
      // The locale's own alias engine decides what its clients answer on the device.
      const engine = queries.length > 0 ? await catalog.aliasEngine(locale, env) : undefined;
      if (queries.length > 0 && !engine) {
        skippedLocales.push(locale);
        console.warn(JSON.stringify({ event: "shards_locale_skipped", locale, reason: "no alias engine" }));
        continue;
      }
      const kept = engine ? queries.filter(createWorkerGate([engine])) : [];
      const prior = createResultStore();
      if (reusable && kept.length > 0) {
        await loadBuild(bucket, localeDir(prefix, served.build, locale), prior, SHARD_WRITE_CONCURRENCY);
      }
      plans.push({ locale, kept, answeredOnDevice: queries.length - kept.length, prior });
    }

    const { allowed, deferred } = allowEmbeddings(plans, limits.maxEmbeddings);
    const budget: Budget = { embedded: 0, failed: 0, calls: 0, failedCalls: 0 };
    const builds: LocaleShards[] = [];
    let reused = 0;
    for (const plan of plans) {
      const vectors = plan.kept.length > 0 ? await catalog.vectors(plan.locale, env) : undefined;
      if (vectors && !vectors.complete) {
        console.warn(JSON.stringify({ event: "shards_locale_vectors_unavailable", locale: plan.locale }));
      }
      const built = await buildShards({
        queries: plan.kept,
        reachesWorker: () => true,
        resolver: apiResolver(
          env,
          catalog,
          vectors?.complete ? vectors.indexes : undefined,
          allowed.get(plan.locale) ?? new Set(),
          budget,
        ),
        packVersion: config.packVersion,
        resultsPerQuery: limits.results,
        maxShardBytes: limits.maxShardBytes,
        batchSize: catalog.model.maxBatch,
        previous: (wanted, store) => reuse(plan.prior, wanted, store, limits.results),
      });
      reused += built.stats.reused;
      // English always has its files, even empty: they replace a served English build.
      if (plan.locale === ROOT_LOCALE || built.store.size > 0) builds.push({ locale: plan.locale, built });
    }
    builds.sort((a, b) => compare(a.locale, b.locale));

    const locales = Object.fromEntries(
      builds.map(({ locale, built }) => [locale, { queries: built.store.size, shards: built.plans.length }]),
    );
    const counts = {
      candidates: selection.candidates.length,
      privacyDropped: selection.privacyDropped,
      answeredOnDevice: plans.reduce((sum, plan) => sum + plan.answeredOnDevice, 0),
      reused,
      embedded: budget.embedded,
      deferred,
      failed: budget.failed,
      queries: builds.reduce((sum, b) => sum + b.built.store.size, 0),
      shards: builds.reduce((sum, b) => sum + b.built.plans.length, 0),
      locales,
      skippedLocales,
    };
    if (budget.calls > 0 && budget.failedCalls === budget.calls) {
      // Workers AI is down: keep serving the current build rather than a smaller one.
      throw new Error("every Workers AI call failed");
    }
    // With a build served, an empty one replaces it: a query leaves the public files once it no
    // longer passes the thresholds. Without one, the static shards stay.
    if (counts.queries === 0 && !served) {
      console.log(JSON.stringify({ event: "shards_empty", ...counts, ms: Date.now() - started }));
      return report("empty", counts);
    }

    const build = await buildId(builds);
    const unchanged = served?.build === build;
    let bytes = 0;
    if (!unchanged) {
      for (const { locale, built } of builds) {
        bytes += await writeBuild(bucket, localeDir(prefix, build, locale), built, SHARD_WRITE_CONCURRENCY);
      }
    }
    const pointer: ShardPointer = {
      format: "emojisense-shard-pointer",
      formatVersion: 1,
      build,
      previous: unchanged ? (served?.previous ?? null) : (served?.build ?? null),
      model: modelTag(catalog),
      results: limits.results,
      queries: counts.queries,
      shards: counts.shards,
      locales,
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
