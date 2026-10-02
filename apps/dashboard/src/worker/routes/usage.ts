import { getPlan, METRICS, type Metric } from "@emojisense/platform";
import type { UsageResponse } from "../../shared/contract";
import type { AuthedContext } from "../env";
import { json } from "../http";
import { measureUsage } from "../plans";
import { requireOwnedApp } from "../records";
import { parsePeriod } from "../validate";

/** Counters come from `usage_monthly`, which the API Worker flushes in batches. */
export async function getUsage({ url, env, deps, account, params }: AuthedContext): Promise<Response> {
  const app = await requireOwnedApp(env.DB, params.id, account.id);
  const period = parsePeriod(url.searchParams.get("period"), deps.now());
  const { results } = await env.DB.prepare(
    "SELECT metric, count FROM usage_monthly WHERE app_id = ? AND period = ?",
  )
    .bind(app.id, period)
    .all<{ metric: Metric; count: number }>();
  const used = new Map(results.map((row) => [row.metric, row.count]));
  const plan = getPlan(app.plan);

  const body: UsageResponse = {
    appId: app.id,
    period,
    plan: { id: plan.id, name: plan.name },
    metrics: METRICS.map((metric) => measureUsage(metric, used.get(metric) ?? 0, plan.limits[metric])),
  };
  return json(body);
}
