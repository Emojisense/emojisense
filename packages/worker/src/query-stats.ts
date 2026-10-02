import { dayOf } from "@emojisense/platform";
import { MAX_QUERY_LENGTH } from "emojisense";
import {
  FLUSH_INTERVAL_MS,
  FLUSH_MAX_PENDING,
  QUERY_FLUSH_MAX_ROWS,
  QUERY_MAX_PENDING_ROWS,
} from "./config.ts";
import type { WaitUntil } from "./meter.ts";
import type { QueryCount, Store } from "./store.ts";

/** The regional dimensions of one search (query_daily, migration 0004). */
export interface SearchRegion {
  /** The pack locale the search ran in. */
  locale: string;
  /** ISO 3166-1 alpha-2 country of the request, or UNKNOWN_COUNTRY (region.ts `edgeCountry`). */
  country: string;
}

export interface QueryStatsOptions {
  store?: Store | undefined;
  now?: () => number;
  flushIntervalMs?: number;
  flushMaxPending?: number;
  maxRowsPerFlush?: number;
  maxPendingRows?: number;
}

/**
 * Search analytics for the dashboard: per app, UTC day, normalized query, locale and country, how
 * many searches and how many misses (searches that returned no result). Only the caller decides
 * who is counted (context.ts: keyed calls with an apps row); nothing here knows a user, IP or key.
 *
 * Counted in memory per isolate and flushed to query_daily like the Meter: a request starts the
 * flush when it is due (`flushIntervalMs` since the last one, or `flushMaxPending` searches
 * waiting). One flush writes at most `maxRowsPerFlush` rows in one D1 batch, so each request adds
 * bounded work to its waitUntil; the next due flush takes the rest. Unflushed counts are lost
 * when the isolate is evicted, like usage counts (DECISIONS.md, Update #2).
 */
export class QueryStats {
  readonly #store: Store | undefined;
  readonly #now: () => number;
  readonly #flushIntervalMs: number;
  readonly #flushMaxPending: number;
  readonly #maxRowsPerFlush: number;
  readonly #maxPendingRows: number;
  /** app|day|locale|country|query → counts not yet written. The query is last, so the key is unambiguous. */
  readonly #pending = new Map<string, QueryCount>();
  #pendingSearches = 0;
  #dropped = 0;
  #lastFlushAt = Number.NEGATIVE_INFINITY;
  #flushing: Promise<void> | undefined;

  constructor(options: QueryStatsOptions = {}) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.#flushMaxPending = options.flushMaxPending ?? FLUSH_MAX_PENDING;
    this.#maxRowsPerFlush = options.maxRowsPerFlush ?? QUERY_FLUSH_MAX_ROWS;
    this.#maxPendingRows = options.maxPendingRows ?? QUERY_MAX_PENDING_ROWS;
  }

  /** Searches waiting for a flush. */
  get pendingSearches(): number {
    return this.#pendingSearches;
  }

  /** Count one search. `query` is already normalized (≤ 64 characters); a miss has 0 results. */
  add(appId: string, query: string, resultCount: number, region: SearchRegion): void {
    if (!this.#store || query === "") return;
    const text = query.length <= MAX_QUERY_LENGTH ? query : query.slice(0, MAX_QUERY_LENGTH);
    const day = dayOf(this.#now());
    const { locale, country } = region;
    const key = rowKey({ appId, day, locale, country, query: text });
    const missed = resultCount === 0 ? 1 : 0;
    const current = this.#pending.get(key);
    if (current) {
      current.searches += 1;
      current.misses += missed;
    } else if (this.#pending.size >= this.#maxPendingRows) {
      this.#dropped += 1;
      return;
    } else {
      this.#pending.set(key, { appId, day, query: text, locale, country, searches: 1, misses: missed });
    }
    this.#pendingSearches += 1;
  }

  flushIfDue(ctx: WaitUntil): void {
    if (this.#pendingSearches === 0 || this.#flushing) return;
    const due =
      this.#pendingSearches >= this.#flushMaxPending ||
      this.#now() - this.#lastFlushAt >= this.#flushIntervalMs;
    if (due) ctx.waitUntil(this.flush());
  }

  /** Write up to `maxRowsPerFlush` rows as one batch. On failure they stay pending. */
  flush(): Promise<void> {
    if (this.#flushing) return this.#flushing;
    const store = this.#store;
    if (!store || this.#pending.size === 0) return Promise.resolve();
    const rows = this.#take(this.#maxRowsPerFlush);
    this.#lastFlushAt = this.#now();
    if (this.#dropped > 0) {
      console.warn(JSON.stringify({ event: "query_stats_dropped", searches: this.#dropped }));
      this.#dropped = 0;
    }
    this.#flushing = store
      .addQueryCounts(rows)
      .catch((error: unknown) => {
        for (const row of rows) this.#restore(row);
        console.warn(JSON.stringify({ event: "query_stats_flush_failed", error: (error as Error).name }));
      })
      .finally(() => {
        this.#flushing = undefined;
      });
    return this.#flushing;
  }

  #take(max: number): QueryCount[] {
    const rows: QueryCount[] = [];
    for (const [key, row] of this.#pending) {
      if (rows.length >= max) break;
      this.#pending.delete(key);
      this.#pendingSearches -= row.searches;
      rows.push(row);
    }
    return rows;
  }

  #restore(row: QueryCount): void {
    const key = rowKey(row);
    const current = this.#pending.get(key);
    if (current) {
      current.searches += row.searches;
      current.misses += row.misses;
    } else {
      this.#pending.set(key, row);
    }
    this.#pendingSearches += row.searches;
  }
}

const rowKey = (row: Pick<QueryCount, "appId" | "day" | "locale" | "country" | "query">) =>
  `${row.appId}|${row.day}|${row.locale}|${row.country}|${row.query}`;
