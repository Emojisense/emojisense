/**
 * Search analytics (Pro and Scale): the `query_daily` table of migrations/0002_product.sql. The
 * API Worker writes it, a daily cron deletes old rows, and the dashboard reads it.
 */
import { PLAN_IDS, PLANS, type Plan, type PlanId } from "./plans.js";

/** The windows the dashboard offers. A window longer than the plan's retention is cut to it. */
export const ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

/**
 * Plans without analytics keep their rows this long, so an upgrade shows the last week at once
 * (DECISIONS.md, "Search analytics retention").
 */
export const ANALYTICS_MIN_KEEP_DAYS = 7;
export const ANALYTICS_MAX_KEEP_DAYS = 365;

/**
 * The dashboard names a query only when the app saw it at least this often in the window. Rare
 * strings can be personal (ARCHITECTURE.md, invariant 4). Day totals count every search.
 */
export const ANALYTICS_MIN_QUERY_SEARCHES = 5;

/**
 * k-anonymity of the public layer-2 shards, which the API Worker builds nightly from this table:
 * a query is published only when apps of at least this many different accounts searched it…
 */
export const SHARD_MIN_ACCOUNTS = 3;
/** …at least this many times in total… */
export const SHARD_MIN_SEARCHES = 10;
/**
 * …over the last this many complete UTC days. The shortest retention keeps today and the 6 days
 * before it, so every plan still holds these days.
 */
export const SHARD_WINDOW_DAYS = ANALYTICS_MIN_KEEP_DAYS - 1;

const DAY_MS = 86_400_000;

/** Daily key, UTC: "2026-10-15". */
export function dayOf(time: number | Date = Date.now()): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** `day` moved by `days` (negative = earlier). */
export function addDays(day: string, days: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
}

/** How many UTC days (today included) the cron keeps an app's rows on this plan. */
export function analyticsKeepDays(plan: Plan): number {
  return Math.min(ANALYTICS_MAX_KEEP_DAYS, Math.max(ANALYTICS_MIN_KEEP_DAYS, plan.analyticsRetentionDays));
}

/** The cheapest plan whose dashboard shows analytics, for `402 plan_required`. */
export function lowestPlanWithAnalytics(): PlanId {
  return PLAN_IDS.find((id) => PLANS[id].analyticsRetentionDays > 0) ?? "scale";
}
