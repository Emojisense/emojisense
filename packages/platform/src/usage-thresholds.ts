/**
 * `usage.threshold` events: 80% and 100% of a metered limit, once per app, period, metric and
 * threshold.
 *
 * How "once" is remembered without extra state: usage_monthly.count only grows within a period,
 * and each flush adds its calls with one atomic `UPSERT … RETURNING count`. The count before that
 * flush is `total - added`, so exactly one flush, across all isolates, sees a threshold between its
 * before and after values, and only that flush emits the event. The event id is derived from
 * (app, period, metric, threshold, limit), so a receiver can also drop a duplicate.
 *
 * Limits of the approach: a flush whose batch fails is retried with the same delta and still sees
 * the crossing; if the isolate is evicted before the event is sent, it is lost (at most once).
 * A plan change in the middle of a period sets new thresholds; a new crossing then fires again
 * (its data and id carry the new limit). A downgrade below the current count fires nothing.
 */
import type { Metric } from "./plans.js";

export const USAGE_THRESHOLDS = [80, 100] as const;
export type UsageThreshold = (typeof USAGE_THRESHOLDS)[number];

/** One usage_monthly row right after a flush added `added` to it. */
export interface FlushedUsage {
  appId: string;
  period: string;
  metric: Metric;
  added: number;
  /** The row's count after the flush. */
  total: number;
  limit: number;
}

export interface ThresholdCrossing {
  appId: string;
  period: string;
  metric: Metric;
  threshold: UsageThreshold;
  used: number;
  limit: number;
}

/** `data` of a usage.threshold event. */
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
          appId: row.appId,
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

/** Stable across isolates and retries: `evt_` + 32 hex characters of a SHA-256. */
export async function usageThresholdEventId(crossing: ThresholdCrossing): Promise<string> {
  const source = [
    "usage.threshold",
    crossing.appId,
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
