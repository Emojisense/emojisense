/**
 * Webhooks (Scale). The secret (`whsec_…`) is shown once, at creation. Target URLs pass the SSRF
 * guard of @emojisense/platform: https and a public host (http://localhost too in development).
 */
import {
  checkWebhookUrl,
  createWebhookEvent,
  deliverOnce,
  generateWebhookSecret,
  MAX_WEBHOOKS_PER_APP,
  type Parsed,
  parseStoredEvents,
  parseWebhookEvents,
  planAllows,
  randomId,
  WEBHOOK_DELIVERIES_KEPT,
  WEBHOOK_TEST_EVENT,
  type WebhookDeliveryRow,
  type WebhookEnvelopeType,
  type WebhookRow,
} from "@emojisense/platform";
import type {
  CreatedWebhookResponse,
  OkResponse,
  WebhookDeliveriesResponse,
  WebhookDeliverySummary,
  WebhookResponse,
  WebhookSummary,
  WebhooksResponse,
  WebhookTestResponse,
} from "../../shared/contract";
import { type AppAccess, accessFor, assertCan, type Permission, requireAppAccess } from "../access";
import type { D1Database } from "../d1";
import type { AuthedContext, Env } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { requirePlan } from "../plans";
import { isValidId } from "../validate";
import { isDevelopment, webhookRuntime } from "../webhook-runtime";

const requireWebhooksPlan = (access: AppAccess) =>
  requirePlan(access.plan, (plan) => planAllows(plan, "webhooks"), "Webhooks");

async function requireWebhooksAppAccess(ctx: AuthedContext, permission: Permission): Promise<AppAccess> {
  const access = await requireAppAccess(ctx.env.DB, ctx.account.id, ctx.params.id, permission);
  requireWebhooksPlan(access);
  return access;
}

/** A webhook of an app the caller can reach; another account's webhook answers 404. */
async function requireWebhookAccess(
  ctx: AuthedContext,
  permission: Permission,
): Promise<{ webhook: WebhookRow; access: AppAccess }> {
  const id = ctx.params.id;
  const webhook = isValidId(id)
    ? await ctx.env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(id).first<WebhookRow>()
    : null;
  const access = webhook ? await accessFor(ctx.env.DB, ctx.account.id, webhook.app_id) : undefined;
  if (!webhook || !access) throw new HttpError(404, "not_found", "No webhook with this id in your apps.");
  assertCan(access.role, permission);
  requireWebhooksPlan(access);
  return { webhook, access };
}

function valid<T>(parsed: Parsed<T>): T {
  if (parsed.ok) return parsed.value;
  throw new HttpError(400, "invalid_request", parsed.message, parsed.field);
}

function parseUrl(value: unknown, env: Env): string {
  const check = checkWebhookUrl(value, { allowLoopback: isDevelopment(env.ENVIRONMENT) });
  if (!check.ok) throw new HttpError(400, "invalid_request", check.message, "url");
  return check.url;
}

// --- Rows → JSON ------------------------------------------------------------------------------

type WebhookWithLast = WebhookRow & {
  last_id: string | null;
  last_event: string | null;
  last_status: number | null;
  last_duration_ms: number | null;
  last_created_at: number | null;
};

const WEBHOOK_WITH_LAST = `
  SELECT w.*, d.id AS last_id, d.event AS last_event, d.status AS last_status,
    d.duration_ms AS last_duration_ms, d.created_at AS last_created_at
  FROM webhooks w LEFT JOIN webhook_deliveries d ON d.id = (
    SELECT id FROM webhook_deliveries WHERE webhook_id = w.id ORDER BY created_at DESC, id DESC LIMIT 1)`;

function toDeliverySummary(row: Omit<WebhookDeliveryRow, "webhook_id">): WebhookDeliverySummary {
  return {
    id: row.id,
    event: row.event as WebhookEnvelopeType,
    status: row.status,
    ok: row.status !== null && row.status >= 200 && row.status < 300,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

function toWebhookSummary(row: WebhookWithLast): WebhookSummary {
  return {
    id: row.id,
    appId: row.app_id,
    url: row.url,
    events: parseStoredEvents(row.events),
    enabled: row.disabled_at === null,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    lastDelivery:
      row.last_id === null
        ? null
        : toDeliverySummary({
            id: row.last_id,
            event: row.last_event ?? "",
            status: row.last_status,
            duration_ms: row.last_duration_ms,
            created_at: row.last_created_at ?? 0,
          }),
  };
}

async function loadWebhookSummary(db: D1Database, id: string): Promise<WebhookSummary> {
  const row = await db.prepare(`${WEBHOOK_WITH_LAST} WHERE w.id = ?`).bind(id).first<WebhookWithLast>();
  if (!row) throw new HttpError(404, "not_found", "No webhook with this id in your apps.");
  return toWebhookSummary(row);
}

// --- Routes -----------------------------------------------------------------------------------

export async function listWebhooks(ctx: AuthedContext): Promise<Response> {
  const { app } = await requireWebhooksAppAccess(ctx, "view");
  const { results } = await ctx.env.DB.prepare(
    `${WEBHOOK_WITH_LAST} WHERE w.app_id = ? ORDER BY w.created_at, w.id`,
  )
    .bind(app.id)
    .all<WebhookWithLast>();
  const body: WebhooksResponse = { webhooks: results.map(toWebhookSummary) };
  return json(body);
}

/** `{ url, events? }`; events default to all. Answers the secret, once. */
export async function createWebhook(ctx: AuthedContext): Promise<Response> {
  const { app } = await requireWebhooksAppAccess(ctx, "edit");
  const input = await readJsonObject(ctx.request);
  const url = parseUrl(input.url, ctx.env);
  const events = valid(parseWebhookEvents(input.events));
  const id = randomId();
  const secret = generateWebhookSecret();
  // The cap is checked inside the insert, so parallel requests cannot pass it together.
  const result = await ctx.env.DB.prepare(
    `INSERT INTO webhooks (id, app_id, url, secret, events, created_at)
     SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM webhooks WHERE app_id = ?) < ?`,
  )
    .bind(id, app.id, url, secret, JSON.stringify(events), ctx.deps.now(), app.id, MAX_WEBHOOKS_PER_APP)
    .run();
  if (result.meta.changes === 0) {
    throw new HttpError(409, "webhook_limit", `An app can have at most ${MAX_WEBHOOKS_PER_APP} webhooks.`);
  }
  const body: CreatedWebhookResponse = { webhook: await loadWebhookSummary(ctx.env.DB, id), secret };
  return json(body, 201);
}

/** `{ url?, events?, enabled? }`. Disabling keeps the webhook and its deliveries. */
export async function updateWebhook(ctx: AuthedContext): Promise<Response> {
  const { webhook } = await requireWebhookAccess(ctx, "edit");
  const input = await readJsonObject(ctx.request);
  if (!("url" in input) && !("events" in input) && !("enabled" in input)) {
    throw new HttpError(400, "invalid_request", "Send at least one of url, events or enabled.");
  }
  const url = "url" in input ? parseUrl(input.url, ctx.env) : webhook.url;
  const events = "events" in input ? JSON.stringify(valid(parseWebhookEvents(input.events))) : webhook.events;
  let disabledAt = webhook.disabled_at;
  if ("enabled" in input) {
    if (typeof input.enabled !== "boolean") {
      throw new HttpError(400, "invalid_request", "enabled must be true or false.", "enabled");
    }
    disabledAt = input.enabled ? null : (webhook.disabled_at ?? ctx.deps.now());
  }
  await ctx.env.DB.prepare("UPDATE webhooks SET url = ?, events = ?, disabled_at = ? WHERE id = ?")
    .bind(url, events, disabledAt, webhook.id)
    .run();
  const body: WebhookResponse = { webhook: await loadWebhookSummary(ctx.env.DB, webhook.id) };
  return json(body);
}

/** Deletes the webhook; its deliveries go with it (ON DELETE CASCADE). */
export async function deleteWebhook(ctx: AuthedContext): Promise<Response> {
  const { webhook } = await requireWebhookAccess(ctx, "edit");
  await ctx.env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(webhook.id).run();
  const body: OkResponse = { ok: true };
  return json(body);
}

/** Sends one signed `webhook.test` event now, also to a disabled webhook, and reports the result. */
export async function testWebhook(ctx: AuthedContext): Promise<Response> {
  const { webhook } = await requireWebhookAccess(ctx, "edit");
  const event = createWebhookEvent({
    type: WEBHOOK_TEST_EVENT,
    appId: webhook.app_id,
    data: { webhookId: webhook.id, message: "A test event from the Emojisense dashboard." },
    createdAt: ctx.deps.now(),
  });
  const attempt = await deliverOnce(webhookRuntime(ctx), webhook, event);
  const body: WebhookTestResponse = {
    delivery: {
      id: attempt.deliveryId,
      event: attempt.event,
      status: attempt.status,
      ok: attempt.ok,
      durationMs: attempt.durationMs,
      createdAt: attempt.createdAt,
    },
  };
  return json(body);
}

export async function listWebhookDeliveries(ctx: AuthedContext): Promise<Response> {
  const { webhook } = await requireWebhookAccess(ctx, "view");
  const { results } = await ctx.env.DB.prepare(
    "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  )
    .bind(webhook.id, WEBHOOK_DELIVERIES_KEPT)
    .all<WebhookDeliveryRow>();
  const body: WebhookDeliveriesResponse = { deliveries: results.map(toDeliverySummary) };
  return json(body);
}
