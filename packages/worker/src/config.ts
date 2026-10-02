/** Tunables of the API Worker. Plan limits live in @emojisense/platform (`PLANS`), not here. */

/**
 * Workers AI vision model for /v1/classify-image. It takes OpenAI-style chat messages with
 * `image_url` content parts and answers in `choices[0].message.content` (checked against the
 * model's published sync-input/sync-output schemas, 2026-10-02).
 */
export const VISION_MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** Bump when the vision prompt changes, so cached captions from the old prompt are not reused. */
export const VISION_PROMPT_VERSION = 2;

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
/** The retention cron deletes query_daily rows in batches of this size… */
export const RETENTION_DELETE_BATCH = 1_000;
/** …and at most this many batches per run. A larger backlog is finished by the next runs. */
export const RETENTION_MAX_BATCHES = 200;

export const BROWSER_CACHE = "public, max-age=3600, s-maxage=86400";
export const EDGE_CACHE_SECONDS = 7 * 24 * 3600;

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
