import {
  ANALYTICS_MIN_QUERY_SEARCHES,
  ANALYTICS_WINDOWS,
  type AnalyticsWindow,
  addDays,
  dayOf,
  getPlan,
  lowestPlanWithAnalytics,
  PLANS,
  type Plan,
} from "@emojisense/platform";
import type { AnalyticsDay, AnalyticsResponse, PlanRequiredBody } from "../../shared/contract";
import type { D1Database } from "../d1";
import type { AuthedContext } from "../env";
import { HttpError, json } from "../http";
import { requireOwnedApp } from "../records";

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

/** The plan lives on the account that owns the app; team members see the owner's plan. */
async function loadOwnerPlan(db: D1Database, ownerId: string): Promise<Plan> {
  const row = await db
    .prepare("SELECT plan FROM accounts WHERE id = ?")
    .bind(ownerId)
    .first<{ plan: string }>();
  return getPlan(row?.plan ?? "free");
}

function planRequired(): Response {
  const plan = lowestPlanWithAnalytics();
  const body: PlanRequiredBody = {
    error: "plan_required",
    plan,
    message: `Search analytics are part of the ${PLANS[plan].name} plan and above.`,
  };
  return json(body, 402);
}

/**
 * Daily totals and top queries from `query_daily`, which the API Worker flushes in batches and a
 * daily cron prunes to the plan's retention (DECISIONS.md, "Search analytics retention").
 */
export async function getAnalytics({ url, env, deps, account, params }: AuthedContext): Promise<Response> {
  // accessFor (the team role gate) is not on main yet: until it lands, only the owner passes.
  // Every role may read analytics, so the gate will only need to admit members too.
  const app = await requireOwnedApp(env.DB, params.id, account.id);
  const requested = parseWindow(url.searchParams.get("days"));
  const plan = await loadOwnerPlan(env.DB, app.account_id);
  if (plan.analyticsRetentionDays <= 0) return planRequired();

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
