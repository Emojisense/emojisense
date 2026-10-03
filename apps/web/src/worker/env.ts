export interface Env {
  /** The built site (dist/). */
  ASSETS: Fetcher;
  /** The search API Worker (packages/worker), called without a key: no model calls, not metered. */
  API: Fetcher;
  /** Query-card renders per visitor IP. */
  OG_IP_LIMITER: RateLimit;
  /** Query-card renders per Cloudflare location, all visitors together. */
  OG_LOCATION_LIMITER: RateLimit;
}
