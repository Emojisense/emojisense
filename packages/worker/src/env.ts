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
  SEARCH_LIMITER?: RateLimiter;
  ANON_LIMITER?: RateLimiter;
  EVENTS?: AnalyticsDataset;
  /** Comma-separated publishable keys. */
  PUBLISHABLE_KEYS?: string;
}

export interface GeneratedConfig {
  packVersion: string;
  modelKey: string;
  modelId: string;
  dims: number;
  queryTemplate: string;
}
