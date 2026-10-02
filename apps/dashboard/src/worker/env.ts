import type { AccountRow, EmojiBucket } from "@emojisense/platform";
import type { D1Database } from "./d1";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  ASSETS?: AssetsBinding;
  /** "development" enables the dev sign-in (on localhost only). Any other value is production. */
  ENVIRONMENT?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Comma-separated website origins that may POST /api/waitlist from a browser. */
  WEBSITE_ORIGINS?: string;
  WAITLIST_LIMITER?: RateLimiter;
  /** R2 bucket `emojisense-emoji` (custom emoji images), shared with the API Worker. */
  EMOJI?: EmojiBucket;
}

/** Side effects the handlers need. Tests replace them with fakes. */
export interface Deps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  /** Keeps background work (webhook deliveries) alive after the response: `ctx.waitUntil`. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** The wait between webhook retries. Tests replace it. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestContext {
  request: Request;
  url: URL;
  env: Env;
  deps: Deps;
  params: Record<string, string>;
}

export interface AuthedContext extends RequestContext {
  account: AccountRow;
}
