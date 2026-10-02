import { type FlushedUsage, type Metric, periodOf } from "@emojisense/platform";
import { FLUSH_INTERVAL_MS, FLUSH_MAX_PENDING, USAGE_SNAPSHOT_TTL_MS } from "./config.ts";
import type { Store, UsageCounts, UsageDelta, UsageTotal } from "./store.ts";

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export interface MeterOptions {
  store?: Store | undefined;
  now?: () => number;
  snapshotTtlMs?: number;
  flushIntervalMs?: number;
  flushMaxPending?: number;
  /**
   * Called after each successful flush with the new totals of the flushed rows and the plan limit
   * last seen for them (usage.threshold webhooks). Its errors never undo the flush.
   */
  onFlushed?: (flushed: FlushedUsage[], ctx: WaitUntil) => void;
}

/**
 * Monthly usage, counted in memory per isolate and flushed to usage_monthly in batches
 * (DECISIONS.md, Update #2). Counts that were not flushed are lost when the isolate is evicted.
 * That error favors the customer and is accepted for soft limits.
 *
 * Workers have no timers between requests, so a flush is started by the request that finds it
 * due: at least `flushIntervalMs` since the last flush, or `flushMaxPending` calls waiting. On a
 * quiet isolate this flushes every call at once; on a busy one, in batches.
 */
export class Meter {
  readonly #store: Store | undefined;
  readonly #now: () => number;
  readonly #snapshotTtlMs: number;
  readonly #flushIntervalMs: number;
  readonly #flushMaxPending: number;
  /** app|period → counts from the store plus the calls this isolate has added since. */
  readonly #snapshots = new Map<string, { counts: UsageCounts; loadedAt: number; loading?: Promise<void> }>();
  /** app|period|metric → calls not yet written to the store. */
  readonly #pending = new Map<string, UsageDelta>();
  /** app|period|metric → calls that are never written to the store (development keys). */
  readonly #memoryOnly = new Map<string, UsageDelta>();
  /** app|metric → the plan limit of the last call counted, for `onFlushed`. */
  readonly #limits = new Map<string, number>();
  readonly #onFlushed: MeterOptions["onFlushed"];
  #pendingCalls = 0;
  #lastFlushAt = Number.NEGATIVE_INFINITY;
  #flushing: Promise<void> | undefined;

  constructor(options: MeterOptions = {}) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#snapshotTtlMs = options.snapshotTtlMs ?? USAGE_SNAPSHOT_TTL_MS;
    this.#flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.#flushMaxPending = options.flushMaxPending ?? FLUSH_MAX_PENDING;
    this.#onFlushed = options.onFlushed;
  }

  /** This period's count, as far as this isolate knows. */
  async count(appId: string, metric: Metric): Promise<number> {
    const snapshot = await this.#snapshot(appId, periodOf(this.#now()));
    return snapshot.counts[metric] ?? 0;
  }

  /**
   * Count one call. `persist: false` keeps it in memory only, for development keys that have no
   * row in the apps table. `limit` is the caller's plan limit for the metric.
   */
  add(appId: string, metric: Metric, persist: boolean, limit?: number): void {
    if (limit !== undefined) this.#limits.set(`${appId}|${metric}`, limit);
    const period = periodOf(this.#now());
    const snapshotKey = `${appId}|${period}`;
    let snapshot = this.#snapshots.get(snapshotKey);
    if (!snapshot) {
      // loadedAt 0 = stale, so the next count() reads the store (and re-adds pending calls).
      snapshot = { counts: {}, loadedAt: 0 };
      this.#snapshots.set(snapshotKey, snapshot);
    }
    snapshot.counts[metric] = (snapshot.counts[metric] ?? 0) + 1;
    const persisted = persist && this.#store !== undefined;
    increment(persisted ? this.#pending : this.#memoryOnly, { appId, period, metric, count: 1 });
    if (persisted) this.#pendingCalls += 1;
  }

  flushIfDue(ctx: WaitUntil): void {
    if (this.#pendingCalls === 0 || this.#flushing) return;
    const due =
      this.#pendingCalls >= this.#flushMaxPending || this.#now() - this.#lastFlushAt >= this.#flushIntervalMs;
    if (due) ctx.waitUntil(this.flush(ctx));
  }

  /**
   * Write all pending calls in one batch. On failure they stay pending for the next flush. With
   * `ctx`, a successful flush is reported to `onFlushed`.
   */
  flush(ctx?: WaitUntil): Promise<void> {
    if (this.#flushing) return this.#flushing;
    const store = this.#store;
    if (!store || this.#pendingCalls === 0) return Promise.resolve();
    const deltas = [...this.#pending.values()];
    this.#pending.clear();
    this.#pendingCalls = 0;
    this.#lastFlushAt = this.#now();
    this.#flushing = store
      .addUsage(deltas)
      .then(
        (totals) => {
          if (ctx) this.#report(deltas, totals, ctx);
        },
        (error: unknown) => {
          for (const delta of deltas) increment(this.#pending, delta);
          this.#pendingCalls += deltas.reduce((sum, d) => sum + d.count, 0);
          console.warn(JSON.stringify({ event: "usage_flush_failed", error: (error as Error).name }));
        },
      )
      .finally(() => {
        this.#flushing = undefined;
      });
    return this.#flushing;
  }

  /** One entry per account, period and metric: this flush's calls of all its apps, and the new total. */
  #report(deltas: readonly UsageDelta[], totals: readonly UsageTotal[], ctx: WaitUntil): void {
    if (!this.#onFlushed) return;
    const added = new Map(deltas.map((d) => [`${d.appId}|${d.period}|${d.metric}`, d.count]));
    const byAccount = new Map<string, FlushedUsage>();
    for (const total of totals) {
      const limit = this.#limits.get(`${total.appId}|${total.metric}`);
      const delta = added.get(`${total.appId}|${total.period}|${total.metric}`);
      if (limit === undefined || delta === undefined) continue;
      const key = `${total.accountId}|${total.period}|${total.metric}`;
      const entry = byAccount.get(key);
      if (entry) entry.added += delta;
      else {
        byAccount.set(key, {
          accountId: total.accountId,
          period: total.period,
          metric: total.metric,
          added: delta,
          total: total.accountCount,
          limit,
        });
      }
    }
    const flushed = [...byAccount.values()];
    try {
      if (flushed.length > 0) this.#onFlushed(flushed, ctx);
    } catch (error) {
      console.warn(JSON.stringify({ event: "usage_report_failed", error: (error as Error).name }));
    }
  }

  async #snapshot(appId: string, period: string) {
    const key = `${appId}|${period}`;
    let snapshot = this.#snapshots.get(key);
    if (!snapshot) {
      snapshot = { counts: {}, loadedAt: 0 };
      this.#snapshots.set(key, snapshot);
    }
    if (this.#now() - snapshot.loadedAt >= this.#snapshotTtlMs) {
      snapshot.loading ??= this.#reload(appId, period, snapshot).finally(() => {
        if (snapshot) snapshot.loading = undefined;
      });
      await snapshot.loading;
    }
    return snapshot;
  }

  async #reload(appId: string, period: string, snapshot: { counts: UsageCounts; loadedAt: number }) {
    if (!this.#store) {
      snapshot.loadedAt = this.#now();
      return;
    }
    try {
      const stored = await this.#store.readUsage(appId, period);
      // The store holds every flushed call; add the ones this isolate has not flushed (yet).
      const counts: UsageCounts = { ...stored };
      for (const delta of [...this.#pending.values(), ...this.#memoryOnly.values()]) {
        if (delta.appId === appId && delta.period === period) {
          counts[delta.metric] = (counts[delta.metric] ?? 0) + delta.count;
        }
      }
      snapshot.counts = counts;
    } catch (error) {
      // Keep the local counts and serve; limits are soft. Retry after the next TTL.
      console.warn(JSON.stringify({ event: "usage_read_failed", error: (error as Error).name }));
    }
    snapshot.loadedAt = this.#now();
  }
}

function increment(map: Map<string, UsageDelta>, delta: UsageDelta) {
  const key = `${delta.appId}|${delta.period}|${delta.metric}`;
  const current = map.get(key);
  if (current) current.count += delta.count;
  else map.set(key, { ...delta });
}
