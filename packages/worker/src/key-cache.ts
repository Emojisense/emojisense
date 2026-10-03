import { KEY_CACHE_MAX_ENTRIES, KEY_CACHE_STALE_MS, KEY_CACHE_TTL_MS } from "./config.ts";
import type { ApiKey } from "./store.ts";

export interface KeyCacheOptions {
  now?: () => number;
  ttlMs?: number;
  staleMs?: number;
  maxEntries?: number;
}

export interface CachedKey {
  /** Undefined for a key the store does not have: unknown keys are cached too. */
  key: ApiKey | undefined;
  /** False past the TTL: use the entry only when a new read is refused or fails. */
  fresh: boolean;
}

/**
 * Key lookups per isolate, by key hash. An entry is fresh for `ttlMs`, stale for `staleMs` more,
 * then deleted, so no stale entry outlives that bound, whatever keeps the new read from happening.
 */
export class KeyCache {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxAgeMs: number;
  readonly #maxEntries: number;
  // Map iteration is insertion order and `set` re-inserts, so the oldest entries come first.
  readonly #entries = new Map<string, { key: ApiKey | undefined; storedAt: number }>();

  constructor(options: KeyCacheOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? KEY_CACHE_TTL_MS;
    this.#maxAgeMs = this.#ttlMs + (options.staleMs ?? KEY_CACHE_STALE_MS);
    this.#maxEntries = options.maxEntries ?? KEY_CACHE_MAX_ENTRIES;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(hash: string): CachedKey | undefined {
    const entry = this.#entries.get(hash);
    if (!entry) return undefined;
    const age = this.#now() - entry.storedAt;
    if (age >= this.#maxAgeMs) {
      this.#entries.delete(hash);
      return undefined;
    }
    return { key: entry.key, fresh: age < this.#ttlMs };
  }

  set(hash: string, key: ApiKey | undefined): void {
    const now = this.#now();
    this.#entries.delete(hash);
    for (const [oldest, entry] of this.#entries) {
      if (now - entry.storedAt < this.#maxAgeMs && this.#entries.size < this.#maxEntries) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(hash, { key, storedAt: now });
  }
}
