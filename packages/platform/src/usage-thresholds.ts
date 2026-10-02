/**
 * `usage.threshold` events: 80% and 100% of a metered plan limit, once per account, period,
 * metric and threshold. Plan limits belong to the account, so the count is the account's total:
 * the sum of usage_monthly over all of its apps.
 *
 * How "once" is remembered without a marker table: within a period the account total only
 * grows. Each flush writes its calls and reads the new account total in ONE D1 batch, which is one
 * transaction, and D1 runs transactions one at a time. So the total before a flush is exactly
 * `total - added` (its own calls for that account), the flushes' (before, after] ranges never
 * overlap, and exactly one flush sees each threshold inside its range. Only that flush emits the
 * event. The event id is derived from (account, period, metric, threshold, limit), so a receiver
 * can drop a duplicate too, also when it is subscribed through several apps of the account.
 *
 * Limits of the approach: a flush whose batch fails is retried with its calls still pending and
 * still sees the crossing; if the isolate is evicted before the event is sent, it is lost (at most
 * once). A plan change in the middle of a period sets new thresholds; a new crossing then fires
 * again (data and id carry the new limit). A downgrade below the current total fires nothing.
 */
import type { Metric } from "./plans.js";

export const USAGE_THRESHOLDS = [80, 100] as const;
export type UsageThreshold = (typeof USAGE_THRESHOLDS)[number];

/** One account's usage of one metric right after a flush added `added` calls to it. */
export interface FlushedUsage {
  accountId: string;
  period: string;
  metric: Metric;
  added: number;
  /** The account's total after the flush, over all of its apps. */
  total: number;
  limit: number;
}

export interface ThresholdCrossing {
  accountId: string;
  period: string;
  metric: Metric;
  threshold: UsageThreshold;
  used: number;
  limit: number;
}

/** `data` of a usage.threshold event. `used` and `limit` count every app of the account. */
export interface UsageThresholdData {
  metric: Metric;
  threshold: UsageThreshold;
  period: string;
  used: number;
  limit: number;
}

/** The count at which `threshold`% of `limit` is reached (100% = the over-limit point). */
export function thresholdCount(limit: number, threshold: UsageThreshold): number {
  return Math.ceil((limit * threshold) / 100);
}

export function findThresholdCrossings(flushed: readonly FlushedUsage[]): ThresholdCrossing[] {
  const crossings: ThresholdCrossing[] = [];
  for (const row of flushed) {
    if (!Number.isFinite(row.limit) || row.limit <= 0 || row.added <= 0) continue;
    const before = row.total - row.added;
    for (const threshold of USAGE_THRESHOLDS) {
      const at = thresholdCount(row.limit, threshold);
      if (before < at && row.total >= at) {
        crossings.push({
          accountId: row.accountId,
          period: row.period,
          metric: row.metric,
          threshold,
          used: row.total,
          limit: row.limit,
        });
      }
    }
  }
  return crossings;
}

/** Stable across isolates, retries and apps: `evt_` + 32 hex characters of a SHA-256. */
export async function usageThresholdEventId(crossing: ThresholdCrossing): Promise<string> {
  const source = [
    "usage.threshold",
    crossing.accountId,
    crossing.period,
    crossing.metric,
    crossing.threshold,
    crossing.limit,
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `evt_${hex.slice(0, 32)}`;
}

export function toUsageThresholdData(crossing: ThresholdCrossing): UsageThresholdData {
  return {
    metric: crossing.metric,
    threshold: crossing.threshold,
    period: crossing.period,
    used: crossing.used,
    limit: crossing.limit,
  };
}
