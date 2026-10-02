/**
 * Tunables of the concept tier (DECISIONS.md, "Concept tier for unsure queries"). Kept apart from
 * config.ts so the tier can be read, tuned and removed on its own.
 */

/**
 * Workers AI model that reads an unsure query. Gemma 4 26B-A4B: multilingual, knows people and
 * titles well for its price ($0.10 / $0.30 per M input / output tokens, 2026-10-02), JSON-schema
 * output, and already used for /v1/classify-image. One call is ≈ 180 input + 45 output tokens.
 */
export const CONCEPT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** Bump when the prompt, the schema or the parsing changes: old answers are then not reused. */
export const CONCEPT_PROMPT_VERSION = 1;
/** Part of every cache key of the tier: model and prompt version. */
export const CONCEPT_TAG = `${CONCEPT_MODEL.split("/").at(-1)}:${CONCEPT_PROMPT_VERSION}`;

/** Concept terms and emoji kept from one answer. */
export const MAX_CONCEPT_TERMS = 6;
export const MAX_CONCEPT_EMOJI = 8;
/** Concept terms shown as "understood as" (catalog phrases only). */
export const MAX_DISPLAY_TERMS = 3;
/** Concept results merged into a search answer. */
export const MAX_CONCEPT_RESULTS = 8;

/**
 * A search waits this long for the model. Past it the answer says `concept.status: "pending"`
 * (not cached) and the call goes on in the background to fill the caches.
 */
export const CONCEPT_TIMEOUT_MS = 3_000;
/** Model calls in flight per isolate. More wait for nothing: the answer says "unavailable". */
export const CONCEPT_MAX_IN_FLIGHT = 4;
/** Default of the CONCEPT_DAILY_CAP var: model calls per UTC day for all keys together. */
export const CONCEPT_DEFAULT_DAILY_CAP = 20_000;
/** Concept answers are kept this long in the edge cache. */
export const CONCEPT_EDGE_CACHE_SECONDS = 7 * 24 * 3600;
/** concept_cache rows older than this are deleted by the nightly job, so answers refresh. */
export const CONCEPT_CACHE_DAYS = 90;
/** Model calls a nightly precompute may make (NIGHTLY_CONCEPTS in the shard job). */
export const CONCEPT_NIGHTLY_MAX_CALLS = 500;
/**
 * Extra `semantic_calls` metered for a search whose concept answer needed a model call. Cached
 * concept answers add nothing.
 */
export const CONCEPT_METERED_CALLS = 1;
