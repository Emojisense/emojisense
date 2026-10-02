import { METRICS, type Metric } from "@emojisense/platform";
import type { UsageResponse } from "../../shared/contract";
import { requireAppAccess } from "../access";
import type { AuthedContext } from "../env";
import { json } from "../http";
import { measureUsage } from "../plans";
import { parsePeriod } from "../validate";

/**
 * Counters come from `usage_monthly`, which the API Worker flushes in batches. Rows are per app,
 * but plan limits are per account: each metric is measured on the total of all apps of the
 * owning account, with this app's part next to it.
 */
export async function getUsage({ url, env, deps, account, params }: AuthedContext): Promise<Response> {
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "view");
  const period = parsePeriod(url.searchParams.get("period"), deps.now());
  const { results } = await env.DB.prepare(
    `SELECT u.metric, SUM(u.count) AS account_count,
       SUM(CASE WHEN u.app_id = ? THEN u.count ELSE 0 END) AS app_count
     FROM usage_monthly u JOIN apps a ON a.id = u.app_id
     WHERE a.account_id = ? AND u.period = ?
     GROUP BY u.metric`,
  )
    .bind(app.id, app.account_id, period)
    .all<{ metric: Metric; account_count: number; app_count: number }>();
  const counts = new Map(results.map((row) => [row.metric, row]));

  const body: UsageResponse = {
    appId: app.id,
    period,
    plan: { id: plan.id, name: plan.name },
    metrics: METRICS.map((metric) => {
      const row = counts.get(metric);
      return {
        ...measureUsage(metric, row?.account_count ?? 0, plan.limits[metric]),
        appUsed: row?.app_count ?? 0,
      };
    }),
  };
  return json(body);
}
