import { type FlushedUsage, type Metric, periodOf } from "@emojisense/platform";
import { FLUSH_INTERVAL_MS, FLUSH_MAX_PENDING, USAGE_SNAPSHOT_TTL_MS } from "./config.ts";
import type { Store, UsageCounts, UsageDelta, UsageTotal } from "./store.ts";

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** Who a call is counted for: its app (the usage_monthly row) and the account whose plan limits it. */
export interface UsageOwner {
  appId: string;
  accountId: string;
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

/** Calls of one app, period and metric that the store does not have yet. */
interface UnflushedUsage extends UsageDelta {
  accountId: string;
}

interface Snapshot {
  counts: UsageCounts;
  loadedAt: number;
  loading?: Promise<void> | undefined;
}

/**
 * Monthly usage, counted in memory per isolate and flushed to usage_monthly in batches
 * (DECISIONS.md, Update #2). Counts that were not flushed are lost when the isolate is evicted.
 * That error favors the customer and is accepted for soft limits.
 *
 * Rows stay per app, but plan limits are per account, so limit checks use the account's total
 * over all of its apps (DECISIONS.md, "Plan limits are metered per account"). Each isolate keeps
 * that total per account: read from the store at most once per `snapshotTtlMs`, replaced by the
 * totals each flush reads in its own batch, and raised by every call the isolate counts. A limit
 * check never costs a D1 query of its own.
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
  /** account|period → the account's counts from the store plus the calls this isolate has added since. */
  readonly #snapshots = new Map<string, Snapshot>();
  /** app|period|metric → calls not yet written to the store. */
  readonly #pending = new Map<string, UnflushedUsage>();
  /** app|period|metric → calls that are never written to the store (development keys). */
  readonly #memoryOnly = new Map<string, UnflushedUsage>();
  /** account|metric → the plan limit of the last call counted, for `onFlushed`. */
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

  /** This period's count of the account over all of its apps, as far as this isolate knows. */
  async accountCount(accountId: string, metric: Metric): Promise<number> {
    const snapshot = await this.#snapshot(accountId, periodOf(this.#now()));
    return snapshot.counts[metric] ?? 0;
  }

  /**
   * Count one call of `owner.appId`. `persist: false` keeps it in memory only, for development
   * keys that have no row in the apps table. `limit` is the account's plan limit for the metric.
   */
  add(owner: UsageOwner, metric: Metric, persist: boolean, limit?: number): void {
    const { appId, accountId } = owner;
    if (limit !== undefined) this.#limits.set(`${accountId}|${metric}`, limit);
    const period = periodOf(this.#now());
    const snapshot = this.#snapshotEntry(accountId, period);
    snapshot.counts[metric] = (snapshot.counts[metric] ?? 0) + 1;
    const persisted = persist && this.#store !== undefined;
    increment(persisted ? this.#pending : this.#memoryOnly, { appId, accountId, period, metric, count: 1 });
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
    const batch = [...this.#pending.values()];
    this.#pending.clear();
    this.#pendingCalls = 0;
    this.#lastFlushAt = this.#now();
    this.#flushing = store
      .addUsage(batch.map(toDelta))
      .then(
        (totals) => {
          this.#refresh(totals);
          if (ctx) this.#report(batch, totals, ctx);
        },
        (error: unknown) => {
          for (const entry of batch) increment(this.#pending, entry);
          this.#pendingCalls += batch.reduce((sum, entry) => sum + entry.count, 0);
          console.warn(JSON.stringify({ event: "usage_flush_failed", error: (error as Error).name }));
        },
      )
      .finally(() => {
        this.#flushing = undefined;
      });
    return this.#flushing;
  }

  /**
   * The flush read each account's new total in its own batch: the flushed calls of every isolate
   * up to that moment. It replaces the snapshot's count at no extra cost, so a busy account's
   * total in this isolate is never older than its last flush. The TTL is left alone: metrics
   * that this isolate does not flush still need the periodic read.
   */
  #refresh(totals: readonly UsageTotal[]): void {
    for (const total of totals) {
      const snapshot = this.#snapshots.get(`${total.accountId}|${total.period}`);
      if (!snapshot) continue;
      const unflushed = this.#unflushedCounts(total.accountId, total.period)[total.metric] ?? 0;
      snapshot.counts[total.metric] = total.accountCount + unflushed;
    }
  }

  /** One entry per account, period and metric: this flush's calls of all its apps, and the new total. */
  #report(batch: readonly UnflushedUsage[], totals: readonly UsageTotal[], ctx: WaitUntil): void {
    if (!this.#onFlushed) return;
    const added = new Map(batch.map((d) => [`${d.appId}|${d.period}|${d.metric}`, d.count]));
    const byAccount = new Map<string, FlushedUsage>();
    for (const total of totals) {
      const limit = this.#limits.get(`${total.accountId}|${total.metric}`);
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

  /** The snapshot of the account and period; a new one is stale (loadedAt 0), so it is read first. */
  #snapshotEntry(accountId: string, period: string): Snapshot {
    const key = `${accountId}|${period}`;
    let snapshot = this.#snapshots.get(key);
    if (!snapshot) {
      snapshot = { counts: {}, loadedAt: 0 };
      this.#snapshots.set(key, snapshot);
    }
    return snapshot;
  }

  async #snapshot(accountId: string, period: string): Promise<Snapshot> {
    const snapshot = this.#snapshotEntry(accountId, period);
    if (this.#now() - snapshot.loadedAt >= this.#snapshotTtlMs) {
      snapshot.loading ??= this.#reload(accountId, period, snapshot).finally(() => {
        snapshot.loading = undefined;
      });
      await snapshot.loading;
    }
    return snapshot;
  }

  async #reload(accountId: string, period: string, snapshot: Snapshot) {
    if (!this.#store) {
      snapshot.loadedAt = this.#now();
      return;
    }
    try {
      const stored = await this.#store.readAccountUsage(accountId, period);
      // The store holds every flushed call; add the ones this isolate has not flushed (yet).
      const counts: UsageCounts = { ...stored };
      for (const [metric, count] of Object.entries(this.#unflushedCounts(accountId, period))) {
        counts[metric as Metric] = (counts[metric as Metric] ?? 0) + count;
      }
      snapshot.counts = counts;
    } catch (error) {
      // Keep the local counts and serve; limits are soft. Retry after the next TTL.
      console.warn(JSON.stringify({ event: "usage_read_failed", error: (error as Error).name }));
    }
    snapshot.loadedAt = this.#now();
  }

  /** This isolate's calls of the account and period that the store does not have. */
  #unflushedCounts(accountId: string, period: string): UsageCounts {
    const counts: UsageCounts = {};
    for (const entry of [...this.#pending.values(), ...this.#memoryOnly.values()]) {
      if (entry.accountId === accountId && entry.period === period) {
        counts[entry.metric] = (counts[entry.metric] ?? 0) + entry.count;
      }
    }
    return counts;
  }
}

const toDelta = ({ appId, period, metric, count }: UnflushedUsage): UsageDelta => ({
  appId,
  period,
  metric,
  count,
});

function increment(map: Map<string, UnflushedUsage>, entry: UnflushedUsage) {
  const key = `${entry.appId}|${entry.period}|${entry.metric}`;
  const current = map.get(key);
  if (current) current.count += entry.count;
  else map.set(key, { ...entry });
}
