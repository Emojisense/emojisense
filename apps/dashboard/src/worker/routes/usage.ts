import { METRICS, type Metric } from "@emojisense/platform";
import type { UsageResponse } from "../../shared/contract";
import { requireAppAccess } from "../access";
import type { AuthedContext } from "../env";
import { json } from "../http";
import { measureUsage } from "../plans";
import { parsePeriod } from "../validate";

/** Counters come from `usage_monthly`, which the API Worker flushes in batches. */
export async function getUsage({ url, env, deps, account, params }: AuthedContext): Promise<Response> {
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "view");
  const period = parsePeriod(url.searchParams.get("period"), deps.now());
  const { results } = await env.DB.prepare(
    "SELECT metric, count FROM usage_monthly WHERE app_id = ? AND period = ?",
  )
    .bind(app.id, period)
    .all<{ metric: Metric; count: number }>();
  const used = new Map(results.map((row) => [row.metric, row.count]));

  const body: UsageResponse = {
    appId: app.id,
    period,
    plan: { id: plan.id, name: plan.name },
    metrics: METRICS.map((metric) => measureUsage(metric, used.get(metric) ?? 0, plan.limits[metric])),
  };
  return json(body);
}
