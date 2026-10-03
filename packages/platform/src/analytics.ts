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
 * query_daily's key starts with the day (migration 0009), so the rows of one app are read one day
 * at a time: `WITH RECURSIVE ${QUERY_DAYS} …` binds the first and the last day ('YYYY-MM-DD'), and
 * a join on `q.day = days.day AND q.app_id = ?` seeks the key for each day instead of scanning.
 */
export const QUERY_DAYS =
  "days(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < ?)";

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

/**
 * Regional dimensions of query_daily (migration 0004). The country comes from the request's edge
 * location (`request.cf.country`); this code stands for an unknown country (Tor, no data)…
 */
export const UNKNOWN_COUNTRY = "XX";
/** …and this locale for rows written before the table had a locale. */
export const LEGACY_LOCALE = "und";
/** trends_daily: the row of a locale over every country, unknown ones included. */
export const ALL_COUNTRIES = "*";

/**
 * Regional trends (trends_daily), for the culture proposals: the last this many complete UTC
 * days (every plan still holds them when the daily cron runs, before its prune)…
 */
export const TRENDS_RECENT_DAYS = 7;
/** …against the this many days before them. */
export const TRENDS_BASELINE_DAYS = 28;
/** k-anonymity of a trend row, per locale and country: the thresholds of the public shards. */
export const TRENDS_MIN_ACCOUNTS = SHARD_MIN_ACCOUNTS;
export const TRENDS_MIN_SEARCHES = SHARD_MIN_SEARCHES;
/** A trend row with at least this score is "rising": twice the searches per day of its baseline. */
export const TRENDS_RISING_SCORE = 2;
/** The daily cron deletes trends_daily rows older than this many days. */
export const TRENDS_KEEP_DAYS = 90;

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
