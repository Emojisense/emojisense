/** Tunables of culture Phase 2: the nightly proposal job, the R2 override and its route. */

/**
 * Workers AI model for culture proposals: multilingual (the 11 pack locales), answers in a JSON
 * schema (`response_format`), and the cheapest of the current instruct models at $0.10 / $0.30 per
 * million input / output tokens (checked 2026-10-02). The vision route uses the same model.
 */
export const CULTURE_PROPOSE_MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** The prompt file, packages/data/culture/prompts/propose.v2.md. Recorded in every draft. */
export const CULTURE_PROMPT_VERSION = "v2";
/**
 * Answer token cap: the emoji list and JSON syntax, plus a context sentence and up to 8 triggers
 * per locale (≈ 120 tokens). A holiday for all 11 locales gets ≈ 1,900.
 */
export const CULTURE_PROPOSE_BASE_TOKENS = 300;
export const CULTURE_PROPOSE_TOKENS_PER_LOCALE = 150;

/**
 * Nightly: proposals from the trends (built in the 03:17 run) and the calendar, then a full
 * publish. After the 04:23 shard build, so the two jobs never share an invocation's CPU budget.
 */
export const CULTURE_NIGHTLY_CRON = "41 4 * * *";
/**
 * Every 10 minutes: publish again when the deployed files changed (a deploy) or live entries
 * changed since the last publish. Each run is one R2 read, one D1 read and one asset read when
 * nothing changed.
 */
export const CULTURE_SYNC_CRON = "*/10 * * * *";

/** Default Workers AI calls per night (CULTURE_PROPOSE_BUDGET overrides it). */
export const CULTURE_DEFAULT_BUDGET = 12;
/** Most calls per night whatever the var says. */
export const CULTURE_MAX_BUDGET = 100;
/** Rising queries per (locale, country) that may become candidates. */
export const CULTURE_TRENDS_PER_GROUP = 3;
/** Calendar and event sources that start within this many days become candidates. */
export const CULTURE_CALENDAR_DAYS = 45;
/** Days before a calendar moment that its window opens (people talk about it in advance). */
export const CULTURE_CALENDAR_LEAD_DAYS = 7;
/** A trend that the model calls an event stays on for 7–45 days from today. */
export const CULTURE_TREND_EVENT_DAYS = { min: 7, max: 45 } as const;
/** Proposals listed per page of the admin overview. */
export const CULTURE_OVERVIEW_LIMIT = 200;

/**
 * Most gzip bytes per published locale file: the budget of the git build, so live entries may not
 * make a file larger than a deploy would.
 */
export { CULTURE_GZIP_BUDGET as CULTURE_LIVE_GZIP_BUDGET } from "@emojisense/data/culture-core";

/** Culture files, from R2 or the assets: clients pick up a publish within an hour. */
export const CULTURE_FILE_BROWSER_CACHE = "public, max-age=3600";
/** Edge copies are keyed by build id, whose content never changes. */
export const CULTURE_EDGE_CACHE_SECONDS = 7 * 24 * 3600;
/** How long an isolate trusts the publish pointer it read from R2. */
export const CULTURE_POINTER_TTL_MS = 5 * 60_000;
