import type { CustomEmojiRow } from "@emojisense/platform";
import { type AliasEngine, createEngine, type Pack, type SearchResult } from "emojisense";
import type { Principal } from "./auth.ts";
import { CUSTOM_CACHE_MAX_ENTRIES, CUSTOM_CACHE_TTL_MS, MAX_TENANT_LENGTH } from "./config.ts";
import { buildCustomPack } from "./custom-pack.ts";
import type { CustomEmojiReader } from "./custom-store.ts";
import type { Env } from "./env.ts";

/** One app's (and tenant's) usable custom emoji, with the pack and engine built on first use. */
export class CustomEmojiSet {
  #built: { origin: string; pack: Pack; engine: AliasEngine | undefined } | undefined;

  /**
   * `complete: false` = the database could not be read and nothing older was cached. `tenants`
   * (an app's own set only): the external ids of its tenants that have custom emoji of their own.
   */
  constructor(
    readonly rows: readonly CustomEmojiRow[],
    readonly complete = true,
    readonly tenants: ReadonlySet<string> = new Set(),
  ) {}

  #build(origin: string) {
    if (this.#built?.origin !== origin) {
      const pack = buildCustomPack(this.rows, origin);
      this.#built = { origin, pack, engine: pack.emoji.length > 0 ? createEngine(pack) : undefined };
    }
    return this.#built;
  }

  pack(origin: string): Pack {
    return this.#build(origin).pack;
  }

  search(origin: string, query: string, options: { limit: number; prefix: boolean }): SearchResult[] {
    if (this.rows.length === 0) return [];
    const engine = this.#build(origin).engine;
    return (engine?.search(query, options).results ?? []).map(
      ({ emoji, id, score, imageUrl, shortcode }) => ({
        emoji,
        id,
        score,
        source: "custom" as const,
        ...(imageUrl ? { imageUrl } : {}),
        ...(shortcode ? { shortcode } : {}),
      }),
    );
  }
}

const EMPTY = new CustomEmojiSet([]);
const UNAVAILABLE = new CustomEmojiSet([], false);

/** Where custom emoji images are served: `API_URL` when set (as in the dashboard), else this origin. */
export function imageOrigin(env: Env, url: URL): string {
  return env.API_URL || url.origin;
}

/** The app of a keyed caller. Development keys have no apps row, so no custom emoji either. */
export function callerApp(caller: Principal): string | undefined {
  return caller.kind === "key" && caller.persistUsage ? caller.key.appId : undefined;
}

/** `tenant=<externalId>`: an opaque string of the app owner, at most 128 characters. */
export function parseTenant(raw: unknown): string | undefined | "invalid" {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.length > MAX_TENANT_LENGTH) return "invalid";
  return raw;
}

export interface CustomEmojiIndexOptions {
  reader?: CustomEmojiReader | undefined;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}

/**
 * Custom emoji per app, cached per isolate for `ttlMs` (apps without any included), with the
 * tenants that have emoji of their own. Only those tenants get a set (and an engine) of their own;
 * any other `tenant=` gets the app's set, so made-up tenant ids add no cache entries. When D1
 * fails, a stale set is used; with none, the search goes on without custom emoji (search never
 * fails hard).
 */
export class CustomEmojiIndex {
  readonly #reader: CustomEmojiReader | undefined;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #cache = new Map<string, { set: CustomEmojiSet; expiresAt: number }>();
  readonly #loading = new Map<string, Promise<CustomEmojiSet>>();

  constructor(options: CustomEmojiIndexOptions = {}) {
    this.#reader = options.reader;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? CUSTOM_CACHE_TTL_MS;
    this.#maxEntries = options.maxEntries ?? CUSTOM_CACHE_MAX_ENTRIES;
  }

  get reader(): CustomEmojiReader | undefined {
    return this.#reader;
  }

  /** The cached set, reloaded after `ttlMs`. */
  async get(appId: string, tenant?: string): Promise<CustomEmojiSet> {
    const app = await this.#cached(appId, undefined);
    return tenant !== undefined && app.tenants.has(tenant) ? this.#cached(appId, tenant) : app;
  }

  /** Reads D1 now (parallel callers share one read) and caches the result. */
  async load(appId: string, tenant?: string): Promise<CustomEmojiSet> {
    const app = await this.#read(appId, undefined);
    return tenant !== undefined && app.tenants.has(tenant) ? this.#read(appId, tenant) : app;
  }

  /**
   * The caller's custom emoji. Anonymous and development callers have none. An app that had none
   * when its key was read (the key cache, as old as this cache) costs no read, unless a fresh
   * read of its emoji is cached (`load` from the custom pack route).
   */
  async forCaller(caller: Principal, tenant: string | undefined): Promise<CustomEmojiSet> {
    const appId = callerApp(caller);
    if (!appId) return EMPTY;
    const none = caller.kind === "key" && caller.key.hasCustomEmoji === false;
    if (none && !this.#cache.has(cacheKey(appId, undefined))) return EMPTY;
    return this.get(appId, tenant);
  }

  async #cached(appId: string, tenant: string | undefined): Promise<CustomEmojiSet> {
    const cached = this.#cache.get(cacheKey(appId, tenant));
    if (cached && cached.expiresAt > this.#now()) return cached.set;
    return this.#read(appId, tenant);
  }

  #read(appId: string, tenant: string | undefined): Promise<CustomEmojiSet> {
    const reader = this.#reader;
    if (!reader) return Promise.resolve(EMPTY);
    const key = cacheKey(appId, tenant);
    const pending = this.#loading.get(key);
    if (pending) return pending;
    const read =
      tenant === undefined
        ? Promise.all([reader.listUsable(appId), reader.listTenantsWithEmoji(appId)]).then(
            ([rows, tenants]) => new CustomEmojiSet(rows, true, new Set(tenants)),
          )
        : reader.listUsable(appId, tenant).then((rows) => new CustomEmojiSet(rows));
    const loading = read
      .then(
        (set) => {
          this.#remember(key, set);
          return set;
        },
        (error: unknown) => {
          console.warn(JSON.stringify({ event: "custom_emoji_unavailable", error: (error as Error).name }));
          return this.#cache.get(key)?.set ?? UNAVAILABLE;
        },
      )
      .finally(() => this.#loading.delete(key));
    this.#loading.set(key, loading);
    return loading;
  }

  #remember(key: string, set: CustomEmojiSet) {
    this.#cache.delete(key);
    if (this.#cache.size >= this.#maxEntries) {
      // Map iteration is insertion order: drop the oldest entry.
      this.#cache.delete(this.#cache.keys().next().value as string);
    }
    this.#cache.set(key, { set, expiresAt: this.#now() + this.#ttlMs });
  }
}

const cacheKey = (appId: string, tenant: string | undefined) => `${appId}\n${tenant ?? ""}`;

/** Custom matches go first (docs/API.md); the list keeps the request's limit. */
export function mergeCustom(custom: SearchResult[], results: SearchResult[], limit: number): SearchResult[] {
  return custom.length === 0 ? results : [...custom, ...results].slice(0, limit);
}

/** Browsers may keep answers with an app's own emoji only briefly: they change in the dashboard. */
export const CUSTOM_BROWSER_CACHE = "private, max-age=60";
