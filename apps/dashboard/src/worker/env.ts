import type { AccountRow, CachePurger, CultureAdminRpc, EmojiBucket } from "@emojisense/platform";
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
  /** "Send test event", per webhook (5 a minute). */
  WEBHOOK_TEST_LIMITER?: RateLimiter;
  /** R2 bucket `emojisense-emoji` (custom emoji images), shared with the API Worker. */
  EMOJI?: EmojiBucket;
  /** Base URL of the API Worker, which serves custom emoji images (e.g. https://api.emojisense.com). */
  API_URL?: string;
  /** Whop API base. Default https://api.whop.com/api/v1; the sandbox is https://sandbox-api.whop.com/api/v1. */
  WHOP_API_BASE?: string;
  /** Public JSON map of our plans and intervals to Whop variant ids (scripts/whop-setup.mjs writes it). */
  WHOP_PLAN_IDS?: string;
  /** Public: the Whop company that sells the plans, `biz_…`. */
  WHOP_COMPANY_ID?: string;
  /** Secret: creates checkouts and cancels a membership that a new plan replaced. */
  WHOP_API_KEY?: string;
  /** Secret: the Whop webhook's signing secret, `ws_…`, exactly as Whop shows it. */
  WHOP_WEBHOOK_SECRET?: string;
  /**
   * Comma-separated emails of the accounts that see the internal Culture page. Compared with the
   * verified email claim of the Clerk session (or the dev sign-in email locally).
   */
  ADMIN_EMAILS?: string;
  /**
   * Service binding to the API Worker's `CultureAdmin` RPC entrypoint (culture Phase 2). Not
   * reachable from the internet; the Culture page answers 503 without it.
   */
  CULTURE_ADMIN?: CultureAdminRpc;
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
  /**
   * The zone's Cache API (`caches.default`), shared with the API Worker: deleting a custom emoji
   * purges its cached image in this data center.
   */
  cache?: CachePurger;
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
