import type { AccountRow, EmojiBucket } from "@emojisense/platform";
import type { ClerkFactory } from "./clerk";
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
  /** Clerk publishable key (public): the token issuer is derived from it. */
  CLERK_PUBLISHABLE_KEY?: string;
  /** The Clerk instance's JWT public key, PEM (public). Verifies sessions without a network call. */
  CLERK_JWT_KEY?: string;
  /** Comma-separated origins whose session tokens are accepted (`azp`). Default: the dashboard's own origin. */
  CLERK_AUTHORIZED_PARTIES?: string;
  /** Optional secret. When set, `DELETE /api/me` also deletes the Clerk user. Nothing else needs it. */
  CLERK_SECRET_KEY?: string;
  /** Comma-separated website origins that may POST /api/waitlist from a browser. */
  WEBSITE_ORIGINS?: string;
  WAITLIST_LIMITER?: RateLimiter;
  /** R2 bucket `emojisense-emoji` (custom emoji images), shared with the API Worker. */
  EMOJI?: EmojiBucket;
  /** Base URL of the API Worker, which serves custom emoji images (e.g. https://api.emojisense.com). */
  API_URL?: string;
}

/** Side effects the handlers need. Tests replace them with fakes. */
export interface Deps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  /** Keeps background work (webhook deliveries) alive after the response: `ctx.waitUntil`. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** The wait between webhook retries. Tests replace it. */
  sleep?: (ms: number) => Promise<void>;
  /** Clerk session verification. Tests inject a fake; without it Clerk sign-in is off. */
  clerk?: ClerkFactory;
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
  /**
   * The caller's verified email for this request, in lower case: the Clerk session's verified
   * email claim, or the dev account's email. `null` when there is none.
   */
  verifiedEmail: string | null;
}
