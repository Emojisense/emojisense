import {
  ANALYTICS_MIN_QUERY_SEARCHES,
  ANALYTICS_WINDOWS,
  type AnalyticsWindow,
  addDays,
  dayOf,
  lowestPlanWithAnalytics,
  PLANS,
} from "@emojisense/platform";
import type { AnalyticsDay, AnalyticsResponse } from "../../shared/contract";
import { requireAppAccess } from "../access";
import type { AuthedContext } from "../env";
import { HttpError, json, planRequired } from "../http";

const DEFAULT_WINDOW: AnalyticsWindow = 30;
/** Length of each top list. */
export const TOP_QUERIES = 20;

function parseWindow(value: string | null): AnalyticsWindow {
  if (value === null || value === "") return DEFAULT_WINDOW;
  const days = ANALYTICS_WINDOWS.find((window) => String(window) === value);
  if (days !== undefined) return days;
  throw new HttpError(
    400,
    "invalid_request",
    `days must be one of: ${ANALYTICS_WINDOWS.join(", ")}.`,
    "days",
  );
}

/**
 * Daily totals and top queries from `query_daily`, which the API Worker flushes in batches and a
 * daily cron prunes to the plan's retention (DECISIONS.md, "Search analytics retention").
 * Every team role may read them; the app owner's plan decides retention.
 */
export async function getAnalytics({ url, env, deps, account, params }: AuthedContext): Promise<Response> {
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "view");
  const requested = parseWindow(url.searchParams.get("days"));
  if (plan.analyticsRetentionDays <= 0) {
    const required = lowestPlanWithAnalytics();
    throw planRequired(required, `Search analytics are part of the ${PLANS[required].name} plan and above.`);
  }

  const window = Math.min(requested, plan.analyticsRetentionDays);
  const to = dayOf(deps.now());
  const from = addDays(to, 1 - window);
  const range = [app.id, from, to] as const;
  const [totals, topQueries, topMisses] = await Promise.all([
    env.DB.prepare(
      `SELECT day, SUM(searches) AS searches, SUM(misses) AS misses FROM query_daily
       WHERE app_id = ? AND day BETWEEN ? AND ? GROUP BY day`,
    )
      .bind(...range)
      .all<AnalyticsDay>(),
    env.DB.prepare(
      `SELECT query, SUM(searches) AS searches FROM query_daily
       WHERE app_id = ? AND day BETWEEN ? AND ?
       GROUP BY query HAVING SUM(searches) >= ?
       ORDER BY SUM(searches) DESC, query LIMIT ?`,
    )
      .bind(...range, ANALYTICS_MIN_QUERY_SEARCHES, TOP_QUERIES)
      .all<{ query: string; searches: number }>(),
    env.DB.prepare(
      `SELECT query, SUM(misses) AS misses FROM query_daily
       WHERE app_id = ? AND day BETWEEN ? AND ?
       GROUP BY query HAVING SUM(misses) > 0 AND SUM(searches) >= ?
       ORDER BY SUM(misses) DESC, query LIMIT ?`,
    )
      .bind(...range, ANALYTICS_MIN_QUERY_SEARCHES, TOP_QUERIES)
      .all<{ query: string; misses: number }>(),
  ]);

  const byDay = new Map(totals.results.map((row) => [row.day, row]));
  const days: AnalyticsDay[] = Array.from({ length: window }, (_, i) => {
    const day = addDays(from, i);
    const row = byDay.get(day);
    return { day, searches: row?.searches ?? 0, misses: row?.misses ?? 0 };
  });
  const body: AnalyticsResponse = { days, topQueries: topQueries.results, topMisses: topMisses.results };
  return json(body);
}
