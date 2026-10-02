import { getPlan, hashKey, keyKind, originAllowed, type Plan } from "@emojisense/platform";
import { KEY_CACHE_MAX_ENTRIES, KEY_CACHE_TTL_MS } from "./config.ts";
import type { Env } from "./env.ts";
import { errorResponse } from "./http.ts";
import type { ApiKey, Store } from "./store.ts";

export type Principal =
  | {
      kind: "anonymous";
      /**
       * A key was sent, but the key store is down and the key is not cached: served as anonymous
       * (search never fails hard), while routes that need a key answer 503 instead of 401.
       */
      keyUnavailable?: true;
    }
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
        accountId: `dev:${index}`,
        kind: keyKind(token) ?? "publishable",
        plan: getPlan(plan).id,
        allowedOrigins: [],
        revoked: false,
      });
    });
  return keys;
}

export type KeyResolution = ResolvedKey | undefined | "unavailable" | "limited";

export interface ResolveOptions {
  /**
   * Asked before a lookup that misses the isolate cache, i.e. before a D1 read. False refuses the
   * read: the caller gets a stale entry if there is one, else "limited".
   */
  mayLookUp?: () => Promise<boolean>;
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

  async resolve(token: string, options: ResolveOptions = {}): Promise<KeyResolution> {
    const devKey = this.#devKeys.get(token);
    if (devKey) return { key: devKey, persistUsage: false };
    if (!this.#store) return undefined;

    const hash = await hashKey(token);
    const cached = this.#cache.get(hash);
    if (cached && cached.expiresAt > this.#now()) return wrap(cached.key);
    // Random keys always miss the cache: each would cost a D1 read without this gate.
    if (options.mayLookUp && !(await options.mayLookUp())) return cached ? wrap(cached.key) : "limited";
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
 * only browsers send. No key = anonymous, with the stricter limiter and no model calls.
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

  // The IP is a rate-limit key only. It is never logged or stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  let principal: Principal = { kind: "anonymous" };
  if (token) {
    // Checked before the lookup: the key is already exposed, so say so without a database read.
    if (sentAs === "query" && keyKind(token) === "secret") {
      return errorResponse(403, "secret keys must be sent as Authorization: Bearer, never in a URL");
    }
    const resolved = await resolver.resolve(token, { mayLookUp: keyLookupGate(env, ip) });
    if (resolved === "limited") return rateLimited();
    if (resolved === "unavailable") {
      // The key store is down and this key is not cached. Serve as anonymous rather than fail
      // (search never fails hard); the anonymous limiter still applies.
      principal = { kind: "anonymous", keyUnavailable: true };
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

  const [limiter, limitKey] =
    principal.kind === "key"
      ? [env.SEARCH_LIMITER, `${principal.key.id}:${ip}`]
      : [env.ANON_LIMITER, `anon:${ip}`];
  if (limiter && !(await limiter.limit({ key: limitKey })).success) return rateLimited();
  return principal;
}

const rateLimited = () => errorResponse(429, "rate limited", { "Retry-After": "60" });

/**
 * For routes that serve keyed callers only: 401 without a key, 503 when a key was sent but the
 * key store cannot be read (the caller should retry, not change its key).
 */
export function keyRequired(caller: Principal, feature: string): Response | undefined {
  if (caller.kind === "key") return undefined;
  if (caller.keyUnavailable) {
    return errorResponse(503, "key check temporarily unavailable", { "Retry-After": "5" });
  }
  return errorResponse(401, `a key is required for ${feature}`);
}

/** Key lookups that miss the isolate cache, per IP (KEY_MISS_LIMITER); none without the binding. */
function keyLookupGate(env: Env, ip: string): (() => Promise<boolean>) | undefined {
  const limiter = env.KEY_MISS_LIMITER;
  if (!limiter) return undefined;
  return async () => (await limiter.limit({ key: `keymiss:${ip}` })).success;
}
