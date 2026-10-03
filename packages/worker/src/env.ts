export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AnalyticsDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  AI?: AiBinding;
  /**
   * Local development without Workers AI (`dev:offline`): scripts/local_embed_server.py, which
   * serves the production embedding model with the same vectors. Used only when AI is unbound.
   */
  LOCAL_EMBED_URL?: string;
  /** Hosted-service database (packages/platform/migrations): keys, apps, usage. */
  DB?: D1Database;
  SEARCH_LIMITER?: RateLimiter;
  ANON_LIMITER?: RateLimiter;
  /** Key lookups that miss the isolate's key cache (each one a D1 read), per IP. */
  KEY_MISS_LIMITER?: RateLimiter;
  /** Publishable-key calls from FIRST_PARTY_ORIGINS (the website's public key), per IP. */
  SITE_LIMITER?: RateLimiter;
  /**
   * Comma-separated origins of our own pages (website, dashboard). Their key calls use
   * SITE_LIMITER, and they may show hosted set images without a key (sets/access.ts).
   */
  FIRST_PARTY_ORIGINS?: string;
  EVENTS?: AnalyticsDataset;
  /** Static assets (public/): the published packs, read for locales outside the bundle. */
  ASSETS?: { fetch(input: string): Promise<Response> };
  /** Comma-separated `key` or `key:plan` entries accepted without a database row (auth.ts). */
  DEV_KEYS?: string;
  /**
   * R2 bucket `emojisense-emoji`, shared with the dashboard: custom emoji images
   * (`custom/<appId>/<tenantId|_>/<id>.<ext>`).
   */
  EMOJI?: R2Bucket;
  /**
   * R2 bucket `emojisense-shards`, private: its `culture/` prefix holds the published culture
   * builds (src/culture-admin/storage.ts).
   */
  SHARDS?: R2Bucket;
  /**
   * R2 bucket `emojisense-cdn`, public on cdn.emojisense.*: layer-2 shards (src/shards/,
   * PACK_FORMAT §6), written by the nightly job and the base build, also served at /p/* on the
   * API host. Without it, /p/* serves the static shards in public/p (if any).
   */
  CDN?: R2Bucket;
  /** "true" runs the nightly shard build; any other value skips it (wrangler.jsonc). */
  SHARDS_CRON_ENABLED?: string;
  /**
   * "true" runs the nightly culture proposal job (culture-admin/propose.ts); any other value skips
   * it. Publishing approved live entries runs either way.
   */
  CULTURE_CRON_ENABLED?: string;
  /** Workers AI calls per night for culture proposals (default 12, at most 100). */
  CULTURE_PROPOSE_BUDGET?: string;
  /** Public base URL of this API, for custom emoji `imageUrl`. Defaults to the request's origin. */
  API_URL?: string;
  /** "development" allows webhook deliveries to http://localhost. Any other value is production. */
  ENVIRONMENT?: string;
}

export interface GeneratedConfig {
  packVersion: string;
  modelKey: string;
  modelId: string;
  dims: number;
  queryTemplate: string;
  /** Locales with their own vector file, read through ASSETS on first use (PACK_FORMAT §5). */
  vectorLocales: string[];
  /**
   * Hash of the packs, vector files, model and core engine this build serves, written by the sync
   * step (scripts/content-hash.ts). Part of the search cache key, so new data or a new engine
   * under the same pack version is never answered from an older cache entry.
   */
  contentHash: string;
}
