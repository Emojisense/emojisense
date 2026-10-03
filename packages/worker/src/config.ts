/** Tunables of the API Worker. Plan limits live in @emojisense/platform (`PLANS`), not here. */

/**
 * Workers AI vision model for /v1/classify-image. It takes OpenAI-style chat messages with
 * `image_url` content parts and answers in `choices[0].message.content` (checked against the
 * model's published sync-input/sync-output schemas, 2026-10-02).
 */
export const VISION_MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** Bump when the vision prompt changes, so cached captions from the old prompt are not reused. */
export const VISION_PROMPT_VERSION = 2;

/**
 * Alias engines of non-bundled locales (en core + the locale's core and ext packs, 13–18 MB each)
 * kept per isolate. Two keep an isolate near 64 MB of its 128 MB (DECISIONS.md, 2026-10-02).
 */
export const LOCALE_ENGINE_CACHE_SIZE = 2;

/**
 * Locale vector indexes kept per isolate next to the bundled shared one. With bge-m3 (1,914 ×
 * 1024 float32, 8.2 MB each) two engines and two indexes put an isolate near 76 MB of its 128 MB
 * (DECISIONS.md, "Multilingual semantic tier"). EmbeddingGemma @768 rows are 5.9 MB, so three
 * indexes fit the same budget, and one more locale stays resident (fewer 0.3–1.4 s reloads).
 */
export const LOCALE_VECTOR_CACHE_SIZE = 3;

export const SEARCH_DEFAULT_LIMIT = 24;
export const REACTIONS_DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 50;

/** Reaction text is cut to this many characters (≈ 64 tokens) before it reaches any model. */
export const MAX_REACTION_CHARS = 256;
/** Reaction request bodies above this size are refused before JSON parsing. */
export const MAX_REACTION_BODY_BYTES = 16 * 1024;
export const MAX_IMAGE_BYTES = 256 * 1024;

/** Revocations and plan changes reach a running isolate within this time. */
export const KEY_CACHE_TTL_MS = 60_000;
/** Upper bound on cached key lookups per isolate, so a flood of random keys cannot grow memory. */
export const KEY_CACHE_MAX_ENTRIES = 10_000;
/** How long an isolate trusts its usage snapshot before it reads usage_monthly again. */
export const USAGE_SNAPSHOT_TTL_MS = 60_000;
/** Usage is flushed to D1 when this much time has passed since the last flush… */
export const FLUSH_INTERVAL_MS = 10_000;
/** …or when this many calls are waiting, whichever comes first. */
export const FLUSH_MAX_PENDING = 100;
/** Search analytics: at most this many query_daily rows per flush (one D1 batch); the rest wait. */
export const QUERY_FLUSH_MAX_ROWS = 100;
/** Distinct rows an isolate holds while D1 is down. New rows past it are dropped (best effort). */
export const QUERY_MAX_PENDING_ROWS = 10_000;
/** The retention cron deletes query_daily and waitlist rows in batches of this size… */
export const RETENTION_DELETE_BATCH = 1_000;
/** …and at most this many batches per run. A larger backlog is finished by the next runs. */
export const RETENTION_MAX_BATCHES = 200;

export const BROWSER_CACHE = "public, max-age=3600, s-maxage=86400";
/**
 * Answers with the culture layer (on unless `culture=0`): no longer than the culture file itself
 * (max-age=3600), so no shared cache keeps a seasonal emoji a day past its window.
 */
export const CULTURE_BROWSER_CACHE = "public, max-age=3600";
/**
 * Answers that depend on the caller in a way the URL does not show: `region=auto` (the caller's
 * country), or culture windows checked on the caller's local day (its time zone). Only the
 * caller's own browser may keep them, never a shared cache.
 */
export const CALLER_BROWSER_CACHE = "private, max-age=3600";
export const EDGE_CACHE_SECONDS = 7 * 24 * 3600;

/**
 * The nightly layer-2 shard build (src/shards/job.ts), after the 03:17 retention run, so it never
 * reads a query_daily row that a plan's retention has expired. Also listed in wrangler.jsonc.
 */
export const SHARD_BUILD_CRON = "23 4 * * *";
/**
 * The k-anonymity thresholds and the window of the build are SHARD_MIN_ACCOUNTS,
 * SHARD_MIN_SEARCHES and SHARD_WINDOW_DAYS in @emojisense/platform: the privacy pages cite them.
 */
/** Queries per build, most searched first. Bounds memory, shard count and R2 writes per run. */
export const SHARD_MAX_QUERIES = 20_000;
/**
 * New query embeddings per run (Workers AI cost cap). Entries of the current build are reused,
 * so the queries left over are embedded on the next nights.
 */
export const SHARD_MAX_EMBEDDINGS = 5_000;
/**
 * Raw JSON bytes per shard file. Shard JSON compresses about 4×, so this stays under the 30 KB
 * gzip budget of PACK_FORMAT §6 (the Worker has no synchronous gzip to measure it).
 */
export const SHARD_MAX_RAW_BYTES = 96 * 1024;
/** R2 writes in flight at once (Workers allow 6 open connections per invocation). */
export const SHARD_WRITE_CONCURRENCY = 6;
/**
 * Regional trends (src/trends.ts), written by the 03:17 cron: at most this many k-anonymous
 * (locale, country, query) groups are read from D1 per run…
 */
export const TRENDS_MAX_CANDIDATES = 20_000;
/** …and at most this many rows are written, the most searched first… */
export const TRENDS_MAX_ROWS = 10_000;
/** …with at most this many per locale and country, so a big region cannot crowd out the others. */
export const TRENDS_MAX_ROWS_PER_REGION = 500;
/** Pointers of another data version, and other pack versions, are deleted after this many days unused. */
export const SHARD_STALE_DAYS = 7;
/** A shard file nothing names any more is deleted once it is this old (a run may still be writing). */
export const SHARD_FILE_GRACE_MS = 24 * 3600 * 1000;
/** How long an isolate trusts a live index it read from R2 (the API host's `<key>.json` route). */
export const SHARD_POINTER_TTL_MS = 5 * 60_000;
/**
 * `index.json` changes with each nightly build, so it is never `immutable`: clients pick up a new
 * build within an hour. Shard files are named by their content, so they never change.
 */
export const SHARD_INDEX_BROWSER_CACHE = "public, max-age=3600";
export const SHARD_FILE_CACHE = "public, max-age=31536000, immutable";
/**
 * `<key>.json` on the API host (clients from before hashed files): the same URL serves the next
 * build's file, so it may live a day, as before.
 */
export const SHARD_KEY_FILE_BROWSER_CACHE = "public, max-age=86400";
/** Edge copies (Cache API) of R2 objects; a live index is re-read after SHARD_POINTER_TTL_MS. */
export const SHARD_EDGE_CACHE_SECONDS = 7 * 24 * 3600;
/** A missing file: the client asks the API. Short, so a new build shows up soon. */
export const SHARD_MISSING_CACHE = "public, max-age=300";

/** An app's custom emoji, as one isolate sees them for search, are at most this old. */
export const CUSTOM_CACHE_TTL_MS = 60_000;
/** Upper bound on cached custom emoji sets (app × tenant) per isolate. */
export const CUSTOM_CACHE_MAX_ENTRIES = 1_000;
/** GET /v1/custom-pack is cached at the edge (and in browsers) for this long. */
export const CUSTOM_PACK_CACHE_SECONDS = 60;
/** Part of the custom pack's edge cache key. Bump when the pack layout changes. */
export const CUSTOM_PACK_CACHE_VERSION = "1";
/** `tenant=` is the app owner's own customer id. */
export const MAX_TENANT_LENGTH = 128;

/** POST /v1/events: the largest report accepted (50 picks of 64 characters fit in ~6 KB)… */
export const EVENTS_MAX_BYTES = 16 * 1024;
/** …and the most picks in one (emojisense/stats sends at most 50). */
export const EVENTS_MAX_PICKS = 50;
/** The smallest `sample`: a report counts 1 / sample times, so this bounds one report's weight. */
export const EVENTS_MIN_SAMPLE = 0.001;
