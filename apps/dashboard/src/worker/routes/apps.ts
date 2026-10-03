import { type ApiKeyRow, type EmojiSet, randomId } from "@emojisense/platform";
import type { AppDetailResponse, AppResponse, AppSummary, AppsResponse } from "../../shared/contract";
import { requireAppAccess } from "../access";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { appLimitError, loadAccountPlan, requirePlan } from "../plans";
import { type AppRecord, effectiveRole, queryApps, toAppSummary, toKeySummary } from "../records";
import { parseAppName, parseEmojiSet } from "../validate";

/** The account's own apps first, then apps of teams it belongs to; newest first in each group. */
export async function listApps({ env, account }: AuthedContext): Promise<Response> {
  const { results } = await queryApps(
    env.DB,
    account.id,
    `WHERE a.account_id = ? OR tm.member_id IS NOT NULL
     ORDER BY a.account_id = ? DESC, a.created_at DESC, a.id`,
    account.id,
    account.id,
  ).all<AppRecord>();
  const apps: AppSummary[] = [];
  for (const row of results) {
    const role = effectiveRole(row);
    if (role) apps.push(toAppSummary(row, role));
  }
  const body: AppsResponse = { apps };
  return json(body);
}

/**
 * Apps are created in the caller's own account, within its plan's `maxApps`. Every app has every
 * environment, so an `environment` field from an older client is ignored.
 */
export async function createApp({ request, env, deps, account }: AuthedContext): Promise<Response> {
  const body = await readJsonObject(request);
  const name = parseAppName(body.name);
  const { plan, appCount } = await loadAccountPlan(env.DB, account.id);
  const id = randomId();
  const now = deps.now();

  // The limit check and the insert are one statement, so two parallel requests cannot both
  // pass the check. Unlimited plans skip it (Infinity cannot be bound as a parameter).
  const insert = Number.isFinite(plan.maxApps)
    ? env.DB.prepare(
        `INSERT INTO apps (id, account_id, name, created_at)
         SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM apps WHERE account_id = ?) < ?`,
      ).bind(id, account.id, name, now, account.id, plan.maxApps)
    : env.DB.prepare("INSERT INTO apps (id, account_id, name, created_at) VALUES (?, ?, ?, ?)").bind(
        id,
        account.id,
        name,
        now,
      );
  const result = await insert.run();
  if (result.meta.changes === 0) throw appLimitError(plan, Math.max(appCount, plan.maxApps));

  const record: AppRecord = {
    id,
    account_id: account.id,
    name,
    environment: "prod",
    emoji_set: "native",
    created_at: now,
    owner_plan: plan.id,
    owner_name: account.name,
    owner_email: account.email,
    active_keys: 0,
    active_prod: 0,
    active_staging: 0,
    active_dev: 0,
    role: "owner",
  };
  const response: AppResponse = { app: toAppSummary(record, "owner") };
  return json(response, 201);
}

export async function getApp({ env, account, params }: AuthedContext): Promise<Response> {
  const { app, role } = await requireAppAccess(env.DB, account.id, params.id, "view");
  // Active keys first, newest first within each group.
  const { results } = await env.DB.prepare(
    "SELECT * FROM api_keys WHERE app_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC, id",
  )
    .bind(app.id)
    .all<ApiKeyRow>();
  const body: AppDetailResponse = { app: toAppSummary(app, role), keys: results.map(toKeySummary) };
  return json(body);
}

/** `{ name?, emojiSet? }`. A hosted emoji set needs a plan with `hostedEmojiSets`; "native" never does. */
export async function updateApp({ request, env, account, params }: AuthedContext): Promise<Response> {
  const { app, role, plan } = await requireAppAccess(env.DB, account.id, params.id, "edit");
  const body = await readJsonObject(request);
  if (body.name === undefined && body.emojiSet === undefined) {
    throw new HttpError(400, "invalid_request", "Send name, emojiSet or both.");
  }
  const name = body.name === undefined ? app.name : parseAppName(body.name);
  const emojiSet: EmojiSet = body.emojiSet === undefined ? app.emoji_set : parseEmojiSet(body.emojiSet);
  if (emojiSet !== "native") requirePlan(plan, (p) => p.hostedEmojiSets, "A hosted emoji set");

  await env.DB.prepare("UPDATE apps SET name = ?, emoji_set = ? WHERE id = ?")
    .bind(name, emojiSet, app.id)
    .run();
  const response: AppResponse = { app: toAppSummary({ ...app, name, emoji_set: emojiSet }, role) };
  return json(response);
}
