import {
  buildShards,
  createResultStore,
  createWorkerGate,
  type HashedLayer,
  hashLayer,
  liveIndexDir,
  liveIndexPath,
  type QueryCount,
  type ResultStore,
  relativeTo,
  resolveFrom,
  SHARD_FILES_DIR,
  SHARD_FORMAT_VERSION,
  type Shard,
  type ShardBaseManifest,
  type ShardIndex,
  type ShardResolver,
  type ShardRow,
} from "@emojisense/data/shards";
import { dayOf, SHARD_MIN_ACCOUNTS, SHARD_MIN_SEARCHES, SHARD_WINDOW_DAYS } from "@emojisense/platform";
import { embeddingText, shardKeyFor } from "emojisense";
import type { VectorIndex } from "emojisense/vectors";
import {
  SHARD_FILE_GRACE_MS,
  SHARD_MAX_EMBEDDINGS,
  SHARD_MAX_QUERIES,
  SHARD_MAX_RAW_BYTES,
  SHARD_STALE_DAYS,
  SHARD_WRITE_CONCURRENCY,
} from "../config.ts";
import type { Env } from "../env.ts";
import { type Catalog, embedTexts, modelTag, semanticModelRows } from "../semantic.ts";
import { type Candidate, selectCandidates, selectionWindow } from "./select.ts";
import {
  baseFiles,
  buildId,
  forEachLimit,
  type LocaleBuild,
  listFiles,
  loadEntries,
  pointerFiles,
  pruneFiles,
  pruneStale,
  readBaseManifest,
  readPointer,
  readPublished,
  type ShardBucket,
  type ShardPointer,
  writeFiles,
  writeLiveIndex,
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
  staleDays: number;
}

export const SHARD_LIMITS: ShardLimits = {
  minAccounts: SHARD_MIN_ACCOUNTS,
  minSearches: SHARD_MIN_SEARCHES,
  windowDays: SHARD_WINDOW_DAYS,
  maxQueries: SHARD_MAX_QUERIES,
  maxEmbeddings: SHARD_MAX_EMBEDDINGS,
  maxShardBytes: SHARD_MAX_RAW_BYTES,
  staleDays: SHARD_STALE_DAYS,
};

/** English: its index is at the version root, which clients from before locale shards read. */
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
  /** Candidates the base layer already answers (left out of the live layer). */
  inBase: number;
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
  /** Queries and shard files per locale of the live build. */
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
  inBase: number;
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
    async resolve(queries) {
      const out = new Map<string, ShardRow[]>();
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
          out.set(q, semanticModelRows(engine, indexes, vector, catalog.glyph?.()));
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

/** Copies the served build's entries of the wanted queries. */
function reuse(prior: ResultStore, wanted: ReadonlySet<string>, store: ResultStore): number {
  let copied = 0;
  for (const q of wanted) {
    const results = prior.get(q);
    if (!results) continue;
    store.set(q, results);
    copied++;
  }
  return copied;
}

/**
 * The queries that the locale's base layer does not answer. Reads the base index and only the
 * base shards the queries fall in.
 */
async function withoutBase(
  bucket: ShardBucket,
  packVersion: string,
  baseIndexPath: string,
  queries: readonly QueryCount[],
): Promise<QueryCount[]> {
  const index = await readPublished<ShardIndex>(bucket, packVersion, baseIndexPath);
  if (!index) return [...queries];
  const byFile = new Map<string, QueryCount[]>();
  for (const query of queries) {
    const key = shardKeyFor(index.keys, query.q);
    const file = key === undefined ? undefined : index.files?.[key];
    if (file === undefined) continue;
    const path = resolveFrom(SHARD_FILES_DIR, file);
    const group = byFile.get(path);
    if (group) group.push(query);
    else byFile.set(path, [query]);
  }
  const held = new Set<string>();
  await forEachLimit([...byFile.keys()], SHARD_WRITE_CONCURRENCY, async (path) => {
    const shard = await readPublished<Shard>(bucket, packVersion, path);
    for (const query of byFile.get(path) ?? []) if (shard?.entries[query.q]) held.add(query.q);
  });
  return queries.filter((query) => !held.has(query.q));
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
  inBase: 0,
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
 * The nightly layer-2 build (DECISIONS.md, "Nightly shard build", "Shards per locale" and "Shards
 * on the CDN"): query_daily over the window → k-anonymity per locale and privacy filters → drop
 * what each locale's device answers and what its base layer holds → reuse the entries of this
 * data's last build, embed the new queries (one budget over every locale, most searched first)
 * → adaptive split per locale → content-named files in the CDN bucket → pointer → live indexes,
 * each naming its locale's base index. Running it again on the same day publishes the same build.
 * Logs counts only, never query text.
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
  if (!env.CDN) return skip("no bucket");
  if (!env.AI) return skip("no Workers AI");

  try {
    const bucket: ShardBucket = env.CDN;
    const { packVersion, contentHash } = catalog.config;
    const model = modelTag(catalog);
    const window = selectionWindow(options.now, limits.windowDays);
    const selection = await selectCandidates(env.DB, window, limits);

    const served = await readPointer(bucket, packVersion, contentHash);
    const reusable = served && served.model === model && served.shardFormat === SHARD_FORMAT_VERSION;
    const manifest = await readBaseManifest(bucket, packVersion);
    // A base built for another model holds other answers: it is neither named nor subtracted.
    const base = manifest?.model === model ? manifest : undefined;

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
      const reaching = engine ? queries.filter(createWorkerGate([engine])) : [];
      const basePath = base?.locales[locale];
      const kept = basePath ? await withoutBase(bucket, packVersion, basePath, reaching) : reaching;
      const prior = createResultStore();
      const servedFiles = reusable ? served.locales[locale]?.files : undefined;
      if (servedFiles && kept.length > 0) {
        await loadEntries(bucket, packVersion, servedFiles, prior, SHARD_WRITE_CONCURRENCY);
      }
      plans.push({
        locale,
        kept,
        answeredOnDevice: queries.length - reaching.length,
        inBase: reaching.length - kept.length,
        prior,
      });
    }

    const { allowed, deferred } = allowEmbeddings(plans, limits.maxEmbeddings);
    const budget: Budget = { embedded: 0, failed: 0, calls: 0, failedCalls: 0 };
    const layers: { locale: string; layer: HashedLayer; queries: number }[] = [];
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
        packVersion,
        maxShardBytes: limits.maxShardBytes,
        batchSize: catalog.model.maxBatch,
        previous: (wanted, store) => reuse(plan.prior, wanted, store),
      });
      reused += built.stats.reused;
      // English always has its index, even empty: it replaces a served English build.
      if (plan.locale === ROOT_LOCALE || built.store.size > 0) {
        layers.push({
          locale: plan.locale,
          layer: await hashLayer(built, liveIndexDir(plan.locale)),
          queries: built.store.size,
        });
      }
    }
    layers.sort((a, b) => compare(a.locale, b.locale));

    const locales = Object.fromEntries(
      layers.map(({ locale, layer, queries }) => [locale, { queries, shards: layer.files.length }]),
    );
    const counts = {
      candidates: selection.candidates.length,
      privacyDropped: selection.privacyDropped,
      answeredOnDevice: plans.reduce((sum, plan) => sum + plan.answeredOnDevice, 0),
      inBase: plans.reduce((sum, plan) => sum + plan.inBase, 0),
      reused,
      embedded: budget.embedded,
      deferred,
      failed: budget.failed,
      queries: layers.reduce((sum, l) => sum + l.queries, 0),
      shards: layers.reduce((sum, l) => sum + l.layer.files.length, 0),
      locales,
      skippedLocales,
    };
    if (budget.calls > 0 && budget.failedCalls === budget.calls) {
      // Workers AI is down: keep serving the current build rather than a smaller one.
      throw new Error("every Workers AI call failed");
    }
    // With a build served, an empty one replaces it: a query leaves the public files once it no
    // longer passes the thresholds. Without one and without a base layer, nothing is published.
    if (counts.queries === 0 && !served && !base) {
      console.log(JSON.stringify({ event: "shards_empty", ...counts, ms: Date.now() - started }));
      return report("empty", counts);
    }

    const build = await buildId(layers);
    const unchanged = served?.build === build;
    const existing = await listFiles(bucket, packVersion);
    let bytes = await writeFiles(
      bucket,
      packVersion,
      layers.flatMap(({ layer }) => layer.files),
      existing,
      SHARD_WRITE_CONCURRENCY,
    );
    const builds: Record<string, LocaleBuild> = Object.fromEntries(
      layers.map(({ locale, layer, queries }) => [
        locale,
        { queries, shards: layer.files.length, files: layer.paths },
      ]),
    );
    const pointer: ShardPointer = {
      format: "emojisense-shard-pointer",
      formatVersion: 2,
      build,
      model,
      shardFormat: SHARD_FORMAT_VERSION,
      queries: counts.queries,
      shards: counts.shards,
      locales: builds,
      previous: unchanged
        ? (served?.previous ?? null)
        : served
          ? { build: served.build, locales: served.locales }
          : null,
      window,
      checkedDay: dayOf(options.now),
    };
    await writePointer(bucket, packVersion, contentHash, pointer);

    // Last: every locale that has live files, had them, or has a base gets its index.
    const published = new Set([
      ...layers.map((l) => l.locale),
      ...Object.keys(served?.locales ?? {}),
      ...Object.keys(base?.locales ?? {}),
    ]);
    for (const locale of [...published].sort(compare)) {
      bytes += await writeLiveIndex(
        bucket,
        packVersion,
        liveIndexPath(locale),
        liveIndex(catalog, locale, layers, base),
      );
    }

    const referenced = new Set([
      ...(await pointerFiles(bucket, packVersion)),
      ...(await baseFiles(bucket, packVersion, manifest)),
    ]);
    const pruned =
      (await pruneFiles(bucket, packVersion, existing, referenced, options.now, SHARD_FILE_GRACE_MS)) +
      (await pruneStale(bucket, packVersion, contentHash, options.now, limits.staleDays));

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

/** A locale's live index: its files of this build (or none), and its base index when there is one. */
function liveIndex(
  catalog: Catalog,
  locale: string,
  layers: readonly { locale: string; layer: HashedLayer }[],
  base: ShardBaseManifest | undefined,
): ShardIndex {
  const own = layers.find((l) => l.locale === locale)?.layer.index;
  const basePath = base?.locales[locale];
  return {
    format: "emojisense-shards",
    formatVersion: 1,
    packVersion: catalog.config.packVersion,
    model: modelTag(catalog),
    keys: own?.keys ?? [],
    files: own?.files ?? {},
    ...(basePath ? { base: relativeTo(liveIndexDir(locale), basePath) } : {}),
  };
}
