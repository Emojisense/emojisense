import { getPlan, hashKey, keyKind, originAllowed, type Plan } from "@emojisense/platform";
import { KEY_CACHE_MAX_ENTRIES, KEY_CACHE_TTL_MS } from "./config.ts";
import type { Env } from "./env.ts";
import { errorResponse } from "./http.ts";
import type { ApiKey, Store } from "./store.ts";

export type Principal =
  | { kind: "anonymous" }
  | {
      kind: "key";
      key: ApiKey;
      plan: Plan;
      /** False for development keys: their usage has no apps row to be written to. */
      persistUsage: boolean;
    };

interface ResolvedKey {
  key: ApiKey;
  persistUsage: boolean;
}

export interface KeyResolverOptions {
  store?: Store | undefined;
  /** `DEV_KEYS`: comma-separated `key` or `key:plan` entries that need no database row. */
  devKeys?: string | undefined;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}

/**
 * Parses `DEV_KEYS`, e.g. "pk_demo, sk_live_local:pro". Dev keys allow any origin and are
 * metered in memory only. They exist so `wrangler dev` works before the database has rows.
 */
export function parseDevKeys(raw: string | undefined): Map<string, ApiKey> {
  const keys = new Map<string, ApiKey>();
  (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry, index) => {
      const [token = "", plan = "free"] = entry.split(":");
      keys.set(token, {
        id: `dev:${index}`,
        appId: `dev:${index}`,
        kind: keyKind(token) ?? "publishable",
        plan: getPlan(plan).id,
        allowedOrigins: [],
        revoked: false,
      });
    });
  return keys;
}

/**
 * Key lookups, cached per isolate for `ttlMs`, unknown keys included, so repeated bad keys do
 * not reach D1. When the store fails, a stale entry is still used; with none, the caller gets
 * "unavailable".
 */
export class KeyResolver {
  readonly #store: Store | undefined;
  readonly #devKeys: Map<string, ApiKey>;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #cache = new Map<string, { key: ApiKey | undefined; expiresAt: number }>();

  constructor(options: KeyResolverOptions = {}) {
    this.#store = options.store;
    this.#devKeys = parseDevKeys(options.devKeys);
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? KEY_CACHE_TTL_MS;
    this.#maxEntries = options.maxEntries ?? KEY_CACHE_MAX_ENTRIES;
  }

  async resolve(token: string): Promise<ResolvedKey | undefined | "unavailable"> {
    const devKey = this.#devKeys.get(token);
    if (devKey) return { key: devKey, persistUsage: false };
    if (!this.#store) return undefined;

    const hash = await hashKey(token);
    const cached = this.#cache.get(hash);
    if (cached && cached.expiresAt > this.#now()) return wrap(cached.key);
    try {
      const key = await this.#store.findKeyByHash(hash);
      this.#remember(hash, key);
      return wrap(key);
    } catch (error) {
      console.warn(JSON.stringify({ event: "key_lookup_failed", error: (error as Error).name }));
      return cached ? wrap(cached.key) : "unavailable";
    }
  }

  #remember(hash: string, key: ApiKey | undefined) {
    this.#cache.delete(hash);
    if (this.#cache.size >= this.#maxEntries) {
      // Map iteration is insertion order: drop the oldest entry.
      this.#cache.delete(this.#cache.keys().next().value as string);
    }
    this.#cache.set(hash, { key, expiresAt: this.#now() + this.#ttlMs });
  }
}

const wrap = (key: ApiKey | undefined): ResolvedKey | undefined =>
  key ? { key, persistUsage: true } : undefined;

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * docs/API.md §Authentication. Publishable keys come as `?key=` and must match the key's allowed
 * origins. Secret keys come as `Authorization: Bearer` and never with an `Origin` header, which
 * only browsers send. No key = anonymous, with the stricter limiter.
 */
export async function authenticate(
  request: Request,
  url: URL,
  env: Env,
  resolver: KeyResolver,
): Promise<Principal | Response> {
  const origin = request.headers.get("Origin");
  const authorization = request.headers.get("Authorization");
  let token: string;
  let sentAs: "header" | "query";
  if (authorization !== null) {
    const match = BEARER.exec(authorization);
    if (!match?.[1]) return errorResponse(401, "Authorization must be `Bearer sk_live_…`");
    token = match[1];
    sentAs = "header";
  } else {
    token = url.searchParams.get("key") ?? "";
    sentAs = "query";
  }

  let principal: Principal = { kind: "anonymous" };
  if (token) {
    // Checked before the lookup: the key is already exposed, so say so without a database read.
    if (sentAs === "query" && keyKind(token) === "secret") {
      return errorResponse(403, "secret keys must be sent as Authorization: Bearer, never in a URL");
    }
    const resolved = await resolver.resolve(token);
    if (resolved === "unavailable") {
      // The key store is down and this key is not cached. Serve as anonymous rather than fail
      // (search never fails hard); the anonymous limiter still applies.
      principal = { kind: "anonymous" };
    } else if (!resolved || resolved.key.revoked) {
      return errorResponse(401, "unknown or revoked key");
    } else {
      const { key } = resolved;
      if (key.kind === "secret") {
        if (sentAs === "query") {
          return errorResponse(403, "secret keys must be sent as Authorization: Bearer, never in a URL");
        }
        if (origin !== null) {
          return errorResponse(
            403,
            "secret keys are for servers; requests with an Origin header are refused",
          );
        }
      } else if (!originAllowed(origin, key.allowedOrigins)) {
        return errorResponse(403, "origin not allowed for this key");
      }
      principal = { kind: "key", key, plan: getPlan(key.plan), persistUsage: resolved.persistUsage };
    }
  }

  // The IP is a rate-limit key only. It is never logged or stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const [limiter, limitKey] =
    principal.kind === "key"
      ? [env.SEARCH_LIMITER, `${principal.key.id}:${ip}`]
      : [env.ANON_LIMITER, `anon:${ip}`];
  if (limiter && !(await limiter.limit({ key: limitKey })).success) {
    return errorResponse(429, "rate limited", { "Retry-After": "60" });
  }
  return principal;
}
