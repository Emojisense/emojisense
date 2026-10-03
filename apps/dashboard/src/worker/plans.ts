import { getPlan, lowestPlanWith, METRICS, type Metric, type Plan } from "@emojisense/platform";
import type { MetricUsage, PlanSummary } from "../shared/contract";
import type { D1Database } from "./d1";
import { type HttpError, planRequired } from "./http";

/** JSON cannot carry Infinity, so unlimited becomes `null`. */
export function finiteOrNull(value: number): number | null {
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
    environments: [...plan.environments],
    hostedEmojiSets: plan.hostedEmojiSets,
    analyticsRetentionDays: plan.analyticsRetentionDays,
    teamMembers: plan.teamMembers,
    tenants: plan.tenants,
  };
}

/** The plan lives on the account (migration 0002); every app of the account gets it. */
export async function loadAccountPlan(
  db: D1Database,
  accountId: string,
): Promise<{ plan: Plan; appCount: number }> {
  const row = await db
    .prepare(
      "SELECT plan, (SELECT COUNT(*) FROM apps WHERE account_id = accounts.id) AS app_count FROM accounts WHERE id = ?",
    )
    .bind(accountId)
    .first<{ plan: string; app_count: number }>();
  return { plan: getPlan(row?.plan ?? "free"), appCount: row?.app_count ?? 0 };
}

/**
 * Throws `planRequired` (402) unless `plan` (the app owner's) passes `test`. The answer names the
 * cheapest plan that does, so the dashboard can offer it. `feature` completes "… needs the Pro plan".
 */
export function requirePlan(plan: Plan, test: (plan: Plan) => boolean, feature: string): void {
  if (test(plan)) return;
  const required = getPlan(lowestPlanWith(test) ?? "scale");
  throw planRequired(
    required.id,
    `${feature} needs the ${required.name} plan or higher. The current plan is ${plan.name}.`,
  );
}

const apps = (n: number) => (Number.isFinite(n) ? `${n} app${n === 1 ? "" : "s"}` : "unlimited apps");

/** `402 plan_required` for app number `appCount + 1`, naming the cheapest plan that allows it. */
export function appLimitError(plan: Plan, appCount: number): HttpError {
  const required = getPlan(lowestPlanWith((p) => p.maxApps > appCount) ?? "scale");
  return planRequired(
    required.id,
    `Your ${plan.name} plan allows ${apps(plan.maxApps)}, and you have reached that limit. ` +
      `${required.name} allows ${apps(required.maxApps)}.`,
  );
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
