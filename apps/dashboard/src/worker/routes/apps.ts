import type { ApiKeyRow } from "@emojisense/platform";
import { randomId } from "@emojisense/platform";
import type { AppDetailResponse, AppResponse, AppsResponse } from "../../shared/contract";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { loadAccountPlan, planLimitMessage } from "../plans";
import { APP_COLUMNS, type AppWithKeyCount, requireOwnedApp, toAppSummary, toKeySummary } from "../records";
import { parseAppName, parseEnvironment } from "../validate";

export async function listApps({ env, account }: AuthedContext): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT ${APP_COLUMNS} FROM apps a WHERE a.account_id = ? ORDER BY a.created_at DESC, a.id`,
  )
    .bind(account.id)
    .all<AppWithKeyCount>();
  const body: AppsResponse = { apps: results.map(toAppSummary) };
  return json(body);
}

export async function createApp({ request, env, deps, account }: AuthedContext): Promise<Response> {
  const body = await readJsonObject(request);
  const name = parseAppName(body.name);
  const environment = parseEnvironment(body.environment);
  const { plan } = await loadAccountPlan(env.DB, account.id);
  const id = randomId();
  const now = deps.now();

  // The limit check and the insert are one statement, so two parallel requests cannot both
  // pass the check. Unlimited plans skip it (Infinity cannot be bound as a parameter).
  const insert = Number.isFinite(plan.maxApps)
    ? env.DB.prepare(
        `INSERT INTO apps (id, account_id, name, environment, plan, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM apps WHERE account_id = ?) < ?`,
      ).bind(id, account.id, name, environment, plan.id, now, account.id, plan.maxApps)
    : env.DB.prepare(
        "INSERT INTO apps (id, account_id, name, environment, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(id, account.id, name, environment, plan.id, now);
  const result = await insert.run();
  if (result.meta.changes === 0) throw new HttpError(403, "plan_limit", planLimitMessage(plan));

  const response: AppResponse = {
    app: toAppSummary({
      id,
      account_id: account.id,
      name,
      environment,
      plan: plan.id,
      created_at: now,
      active_keys: 0,
    }),
  };
  return json(response, 201);
}

export async function getApp({ env, account, params }: AuthedContext): Promise<Response> {
  const app = await requireOwnedApp(env.DB, params.id, account.id);
  // Active keys first, newest first within each group.
  const { results } = await env.DB.prepare(
    "SELECT * FROM api_keys WHERE app_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC, id",
  )
    .bind(app.id)
    .all<ApiKeyRow>();
  const body: AppDetailResponse = { app: toAppSummary(app), keys: results.map(toKeySummary) };
  return json(body);
}
