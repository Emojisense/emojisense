import { getPlan, METRICS, type Metric, PLAN_IDS, PLANS, type Plan } from "@emojisense/platform";
import type { MetricUsage, PlanSummary } from "../shared/contract";
import type { D1Database } from "./d1";

/** JSON cannot carry Infinity, so unlimited becomes `null`. */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function toPlanSummary(plan: Plan): PlanSummary {
  return {
    id: plan.id,
    name: plan.name,
    priceUsdMonthly: plan.priceUsdMonthly,
    limits: Object.fromEntries(METRICS.map((m) => [m, finiteOrNull(plan.limits[m])])) as Record<
      Metric,
      number | null
    >,
    maxApps: finiteOrNull(plan.maxApps),
  };
}

/**
 * Migration 0001 stores the plan per app and has no account plan. Until billing adds one, the
 * account's plan is the best plan among its apps, and new apps inherit it.
 */
export async function loadAccountPlan(
  db: D1Database,
  accountId: string,
): Promise<{ plan: Plan; appCount: number }> {
  const { results } = await db
    .prepare("SELECT plan FROM apps WHERE account_id = ?")
    .bind(accountId)
    .all<{ plan: string }>();
  const rank = (id: string) => PLAN_IDS.indexOf(getPlan(id).id);
  const best = results.reduce((top, row) => (rank(row.plan) > rank(top) ? row.plan : top), "free");
  return { plan: getPlan(best), appCount: results.length };
}

export function planLimitMessage(plan: Plan): string {
  const apps = (n: number) => `${n} app${n === 1 ? "" : "s"}`;
  const base = `Your ${plan.name} plan allows ${apps(plan.maxApps)}, and you have reached that limit.`;
  return plan.maxApps < PLANS.pro.maxApps
    ? `${base} Join the Pro waitlist for up to ${apps(PLANS.pro.maxApps)}.`
    : base;
}

const NEAR_LIMIT_PERCENT = 80;

/**
 * One metric against its plan limit. At `used >= limit` the API already answers with
 * `overLimit: true`, so the dashboard reports the limit as reached at that point.
 */
export function measureUsage(metric: Metric, used: number, limit: number): MetricUsage {
  if (!Number.isFinite(limit)) return { metric, used, limit: null, percent: 0, status: "ok" };
  if (limit <= 0) {
    return {
      metric,
      used,
      limit: 0,
      percent: used > 0 ? 100 : 0,
      status: used > 0 ? "over_limit" : "not_included",
    };
  }
  // Rounded down, so 99.99% never shows as 100% before the limit is hit.
  const percent = Math.min(100, Math.floor((used / limit) * 1000) / 10);
  const status = used >= limit ? "over_limit" : percent >= NEAR_LIMIT_PERCENT ? "near_limit" : "ok";
  return { metric, used, limit, percent, status };
}
