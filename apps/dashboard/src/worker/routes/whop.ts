/**
 * `POST /api/whop/webhook`: Whop's signed billing events. No session: the signature is the
 * authentication. Answers within Whop's 5 seconds: the D1 change is one batch before the answer,
 * so a failure answers 500 and Whop retries; calls to Whop (cancelling retired memberships) and
 * cleanup run in `waitUntil`.
 */
import { DAY_MS, expireLapsedBilling, parseWhopPlanIds } from "@emojisense/platform";
import type { D1Database } from "../d1";
import type { Deps, Env, RequestContext } from "../env";
import { HttpError, json, readCapped } from "../http";
import { billingEnvironment } from "../whop/config";
import { parseWhopEvent, planWhopEvent } from "../whop/events";
import { cancelRetiredMemberships, pruneMemberships } from "../whop/memberships";
import { checkWhopSignature } from "../whop/signature";

/** Whop's payloads are a few KB; this only bounds memory. */
const MAX_BODY_BYTES = 256 * 1024;
/** Whop retries for about 3 days; ids are kept well past that. */
const EVENT_KEEP_DAYS = 30;

function log(level: "info" | "warn" | "error", fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const unconfigured = () =>
  new HttpError(503, "billing_unconfigured", "Payments are not set up on this server yet.");

async function alreadyApplied(db: D1Database, webhookId: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 AS hit FROM whop_events WHERE id = ?").bind(webhookId).first()) !== null;
}

/**
 * After the answer: cancels retired memberships until Whop confirms, prunes old event ids and
 * unattached memberships, and moves lapsed accounts to Free.
 */
function afterResponse(env: Env, deps: Deps, webhookId: string): Promise<unknown> {
  const now = deps.now();
  const work: Promise<unknown>[] = [
    env.DB.batch([
      env.DB.prepare("DELETE FROM whop_events WHERE received_at < ?").bind(now - EVENT_KEEP_DAYS * DAY_MS),
      pruneMemberships(env.DB, now),
    ]),
    expireLapsedBilling(env.DB, now),
    cancelRetiredMemberships(env, deps),
  ];
  return Promise.allSettled(work).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") {
        log("error", {
          event: "whop_background_failed",
          webhookId,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  });
}

export async function whopWebhook({ request, env, deps }: RequestContext): Promise<Response> {
  const secret = env.WHOP_WEBHOOK_SECRET;
  const planIds = parseWhopPlanIds(env.WHOP_PLAN_IDS);
  // 503 makes Whop retry for 3 days, so events wait for the configuration instead of being lost.
  if (!secret || !planIds || Object.keys(planIds).length === 0) {
    log("error", { event: "whop_webhook_unconfigured", secret: Boolean(secret), planIds: Boolean(planIds) });
    throw unconfigured();
  }

  const body = await readCapped(request.body, MAX_BODY_BYTES);
  if (!body) throw new HttpError(413, "body_too_large", "The webhook body is too large.");
  const webhookId = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const failure = await checkWhopSignature({
    id: webhookId,
    timestamp,
    signature: request.headers.get("webhook-signature"),
    body,
    secret,
    nowMs: deps.now(),
  });
  if (failure || !webhookId || !timestamp) {
    log("warn", { event: "whop_webhook_rejected", reason: failure });
    throw new HttpError(401, "invalid_signature", "The webhook signature is not valid.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    log("warn", { event: "whop_webhook_rejected", reason: "invalid_json", webhookId });
    throw new HttpError(400, "invalid_json", "The webhook body is not valid JSON.");
  }
  const type = (payload as { type?: unknown } | null)?.type;
  const event = parseWhopEvent(payload, Number(timestamp) * 1000);
  if (!event) {
    log("info", {
      event: "whop_event",
      webhookId,
      type: typeof type === "string" ? type.slice(0, 64) : null,
      result: "ignored",
      reason: "unhandled_type",
    });
    return json({ ok: true });
  }

  const db = env.DB;
  if (await alreadyApplied(db, webhookId)) {
    log("info", { event: "whop_event", webhookId, type: event.type, result: "duplicate" });
    return json({ ok: true, duplicate: true });
  }
  const plan = await planWhopEvent({ db, planIds, environment: billingEnvironment(env) }, event);
  const remember = db
    .prepare("INSERT INTO whop_events (id, type, received_at) VALUES (?, ?, ?)")
    .bind(webhookId, event.type, deps.now());
  try {
    // One transaction: the event id and its change land together, or neither does.
    await db.batch([remember, ...plan.statements]);
  } catch (error) {
    // A parallel delivery of the same event won the race.
    if (await alreadyApplied(db, webhookId)) return json({ ok: true, duplicate: true });
    throw error;
  }
  log(plan.result === "applied" ? "info" : "warn", {
    event: "whop_event",
    webhookId,
    type: event.type,
    result: plan.result,
    ...(plan.result === "applied" ? { status: plan.status } : { reason: plan.reason }),
  });

  const background = afterResponse(env, deps, webhookId);
  if (deps.waitUntil) deps.waitUntil(background);
  else await background;
  return json({ ok: true });
}
