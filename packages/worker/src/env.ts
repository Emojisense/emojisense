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
  /** Hosted-service database (packages/platform/migrations): keys, apps, usage. */
  DB?: D1Database;
  /** Custom emoji images (bucket `emojisense-emoji`), shared with the dashboard. */
  EMOJI?: R2Bucket;
  SEARCH_LIMITER?: RateLimiter;
  ANON_LIMITER?: RateLimiter;
  EVENTS?: AnalyticsDataset;
  /** Comma-separated `key` or `key:plan` entries accepted without a database row (auth.ts). */
  DEV_KEYS?: string;
  /** R2 bucket `emojisense-emoji`: custom emoji images (`custom/<appId>/<tenantId|_>/<id>.<ext>`). */
  EMOJI?: R2Bucket;
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
}
