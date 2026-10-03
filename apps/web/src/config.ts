/**
 * Build-time settings. Every value can be overridden with a `PUBLIC_*` variable in `.env`
 * (see `.env.example`). The defaults point at the local development servers.
 */
const env = import.meta.env;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export const SITE_URL = trimSlash(env.PUBLIC_SITE_URL ?? "https://emojisense.com");
/** Search API (packages/worker). Serves the data packs and `/v1/search`. */
export const API_URL = trimSlash(env.PUBLIC_API_URL ?? "http://localhost:8788");
/** Dashboard (apps/dashboard). Owns sign-in, keys and `POST /api/waitlist`. */
export const DASHBOARD_URL = trimSlash(env.PUBLIC_DASHBOARD_URL ?? "http://localhost:8790");
export const PACK_VERSION = env.PUBLIC_PACK_VERSION ?? "0.1.0";
/** The website's own publishable key, bound to the site's origin in the dashboard. */
export const PUBLISHABLE_KEY = env.PUBLIC_PUBLISHABLE_KEY ?? "pk_demo";
/** false on internal environments (emojisense.dev): robots.txt disallows all, pages send noindex. */
export const INDEXABLE = env.PUBLIC_INDEXABLE !== "false";
export const REPO_URL = trimSlash(env.PUBLIC_REPO_URL ?? "https://github.com/emojisense/emojisense");

export const PACK_BASE_URL = `${API_URL}/v1/pack/${PACK_VERSION}`;
/** Precomputed results (layer 2): the CDN host when deployed, else the API Worker's /p/ route. */
export const SHARDS_URL = trimSlash(env.PUBLIC_SHARDS_URL ?? `${API_URL}/p/${PACK_VERSION}`);
/** Where search reports go (`POST /v1/events`); none when unset. */
export const STATS_URL = env.PUBLIC_STATS_URL ? trimSlash(env.PUBLIC_STATS_URL) : undefined;
/** Share of visits that report. */
export const STATS_SAMPLE = Number(env.PUBLIC_STATS_SAMPLE ?? "0.1");
export const WAITLIST_ENDPOINT = `${DASHBOARD_URL}/api/waitlist`;
/** Cloudflare Web Analytics site token (cookieless page views); no beacon when unset. */
export const CF_WEB_ANALYTICS_TOKEN = env.PUBLIC_CF_WEB_ANALYTICS_TOKEN || undefined;
/** Google Analytics 4 measurement id; no tag and no consent banner when unset. */
export const GA_MEASUREMENT_ID = env.PUBLIC_GA_MEASUREMENT_ID || undefined;
