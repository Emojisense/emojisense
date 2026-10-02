/**
 * Webhook events and their delivery, shared by the API Worker and the dashboard Worker.
 *
 * Body: `{ id, type, createdAt, appId, data }` (JSON). Header
 * `Emojisense-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, keyed with the whole
 * `whsec_…` secret. Each event is tried up to 3 times (0 s, 10 s, 60 s) inside `waitUntil`, and
 * every attempt is recorded in `webhook_deliveries`, which keeps the last 50 rows per webhook.
 */
import type { D1DatabaseLike, Parsed } from "./d1-like.js";
import { randomId } from "./keys.js";
import { checkWebhookUrl } from "./webhook-url.js";

export const WEBHOOK_EVENTS = [
  "custom_emoji.created",
  "custom_emoji.deleted",
  "tenant.created",
  "tenant.deleted",
  "usage.threshold",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Sent only by "send test event" in the dashboard; no webhook subscribes to it. */
export const WEBHOOK_TEST_EVENT = "webhook.test";
export type WebhookEnvelopeType = WebhookEventType | typeof WEBHOOK_TEST_EVENT;

export interface WebhookEvent<T = unknown> {
  id: string;
  type: WebhookEnvelopeType;
  /** Unix epoch milliseconds. */
  createdAt: number;
  appId: string;
  data: T;
}

export const SIGNATURE_HEADER = "Emojisense-Signature";
export const WEBHOOK_SECRET_PREFIX = "whsec_";
/** Wait before each attempt. The first attempt runs at once. */
export const WEBHOOK_RETRY_DELAYS_MS: readonly number[] = [0, 10_000, 60_000];
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_DELIVERIES_KEPT = 50;
export const MAX_WEBHOOKS_PER_APP = 10;
/** Receivers should refuse signatures older than this (replay protection). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomId(32)}`;
}

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Omitted = every event. An empty list is refused: such a webhook would never fire. */
export function parseWebhookEvents(value: unknown): Parsed<WebhookEventType[]> {
  if (value === undefined) return { ok: true, value: [...WEBHOOK_EVENTS] };
  const invalid = (message: string) => ({ ok: false as const, field: "events", message });
  if (!Array.isArray(value)) return invalid("events must be a list of event names.");
  if (value.length === 0) return invalid("events needs at least one event name.");
  const unknown = value.find((item) => !isWebhookEventType(item));
  if (unknown !== undefined) {
    return invalid(`Unknown event ${JSON.stringify(unknown)}. Use: ${WEBHOOK_EVENTS.join(", ")}.`);
  }
  return { ok: true, value: WEBHOOK_EVENTS.filter((event) => value.includes(event)) };
}

/** The `events` column; a corrupt value subscribes to nothing rather than to everything. */
export function parseStoredEvents(raw: string): WebhookEventType[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isWebhookEventType) : [];
  } catch {
    return [];
  }
}

export function createWebhookEvent<T>(input: {
  type: WebhookEnvelopeType;
  appId: string;
  data: T;
  createdAt: number;
  id?: string;
}): WebhookEvent<T> {
  return {
    id: input.id ?? `evt_${randomId(24)}`,
    type: input.type,
    createdAt: input.createdAt,
    appId: input.appId,
    data: input.data,
  };
}

// --- Signatures -------------------------------------------------------------------------------

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export async function signWebhookBody(
  secret: string,
  body: string,
  timestampSeconds: number,
): Promise<string> {
  const t = Math.floor(timestampSeconds);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

/**
 * Checks a signature header as a receiver would: a `v1` value must match and `t` must be within
 * `toleranceSeconds` of now. Several `v1` values are allowed (for secret rotation).
 */
export async function verifyWebhookSignature(input: {
  secret: string;
  header: string | null;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  if (!input.header) return false;
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of input.header.split(",")) {
    const [name, value = ""] = part.trim().split("=", 2);
    if (name === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (name === "v1" && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === undefined || candidates.length === 0) return false;
  const now = input.nowSeconds ?? Date.now() / 1000;
  if (Math.abs(now - timestamp) > (input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return false;
  const expected = await hmacHex(input.secret, `${timestamp}.${input.body}`);
  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

// --- Delivery ---------------------------------------------------------------------------------

/** What a Worker hands to the delivery code. Tests replace fetch, sleep and the clock. */
export interface WebhookRuntime {
  db: D1DatabaseLike;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  /** `ENVIRONMENT=development`: loopback targets over http are allowed. */
  allowLoopback: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface WebhookTarget {
  id: string;
  url: string;
  secret: string;
}

export interface DeliveryAttempt {
  webhookId: string;
  attempt: number;
  /** HTTP status; null = network error, timeout or a refused target. */
  status: number | null;
  ok: boolean;
  durationMs: number;
  /** The target broke the URL rules; no request was sent and no retry follows. */
  refused?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One POST to one webhook, recorded in webhook_deliveries. Never throws. */
export async function deliverOnce(
  runtime: WebhookRuntime,
  target: WebhookTarget,
  event: WebhookEvent,
  options: { attempt?: number; body?: string } = {},
): Promise<DeliveryAttempt> {
  const now = runtime.now ?? Date.now;
  const attempt = options.attempt ?? 1;
  const check = checkWebhookUrl(target.url, { allowLoopback: runtime.allowLoopback });
  let result: DeliveryAttempt;
  if (!check.ok) {
    result = { webhookId: target.id, attempt, status: null, ok: false, durationMs: 0, refused: true };
  } else {
    const body = options.body ?? JSON.stringify(event);
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtime.timeoutMs ?? WEBHOOK_TIMEOUT_MS);
    let status: number | null = null;
    try {
      const response = await runtime.fetch(check.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Emojisense-Webhooks/1.0",
          "emojisense-event": event.type,
          "emojisense-event-id": event.id,
          [SIGNATURE_HEADER.toLowerCase()]: await signWebhookBody(target.secret, body, now() / 1000),
        },
        body,
        // A redirect could lead to a private address; the receiver must answer at its own URL.
        redirect: "manual",
        signal: controller.signal,
      });
      status = response.status;
      await response.body?.cancel().catch(() => {});
    } catch {
      status = null;
    } finally {
      clearTimeout(timer);
    }
    const ok = status !== null && status >= 200 && status < 300;
    result = { webhookId: target.id, attempt, status, ok, durationMs: Math.max(0, now() - started) };
  }
  await recordDelivery(runtime, target.id, event.type, result);
  return result;
}

/**
 * Up to 3 attempts. Before a retry the webhook is read again, so a deleted or disabled webhook
 * stops and a changed URL or secret is used.
 *
 * Note: Cloudflare ends `waitUntil` work 30 s after the response, so in production the 60 s attempt
 * of an HTTP-triggered invocation is cancelled. Queues (`delaySeconds`) or a Durable Object alarm
 * would make the last retry reliable; the schedule is in WEBHOOK_RETRY_DELAYS_MS.
 */
export async function deliverWithRetries(
  runtime: WebhookRuntime,
  target: WebhookTarget,
  event: WebhookEvent,
): Promise<DeliveryAttempt[]> {
  const sleep = runtime.sleep ?? defaultSleep;
  const body = JSON.stringify(event);
  const attempts: DeliveryAttempt[] = [];
  let current: WebhookTarget | undefined = target;
  for (const [index, delay] of WEBHOOK_RETRY_DELAYS_MS.entries()) {
    if (index > 0) {
      await sleep(delay);
      current = await loadActiveTarget(runtime.db, target.id);
      if (!current) break;
    }
    const attempt = await deliverOnce(runtime, current, event, { attempt: index + 1, body });
    attempts.push(attempt);
    if (attempt.ok || attempt.refused) break;
  }
  if (!attempts.at(-1)?.ok) {
    console.warn(
      JSON.stringify({ event: "webhook_delivery_failed", type: event.type, attempts: attempts.length }),
    );
  }
  return attempts;
}

/** Sends `event` to every enabled webhook of its app that subscribes to the event type. */
export async function dispatchWebhookEvent(
  runtime: WebhookRuntime,
  event: WebhookEvent,
): Promise<DeliveryAttempt[][]> {
  const { results } = await runtime.db
    .prepare("SELECT id, url, secret, events FROM webhooks WHERE app_id = ? AND disabled_at IS NULL")
    .bind(event.appId)
    .all<WebhookTarget & { events: string }>();
  const targets = results.filter((hook) => (parseStoredEvents(hook.events) as string[]).includes(event.type));
  return Promise.all(targets.map((target) => deliverWithRetries(runtime, target, event)));
}

/**
 * Creates the event and delivers it in the background (`waitUntil`). Returns the event at once;
 * a failure is logged, never thrown into the request that caused the event.
 */
export function emitWebhookEvent<T>(
  runtime: WebhookRuntime,
  input: { type: WebhookEventType; appId: string; data: T; id?: string },
): WebhookEvent<T> {
  const event = createWebhookEvent({ ...input, createdAt: (runtime.now ?? Date.now)() });
  runtime.waitUntil(
    dispatchWebhookEvent(runtime, event).catch((error: unknown) => {
      console.warn(
        JSON.stringify({ event: "webhook_dispatch_failed", type: input.type, error: (error as Error).name }),
      );
    }),
  );
  return event;
}

async function loadActiveTarget(db: D1DatabaseLike, id: string): Promise<WebhookTarget | undefined> {
  const row = await db
    .prepare("SELECT id, url, secret FROM webhooks WHERE id = ? AND disabled_at IS NULL")
    .bind(id)
    .first<WebhookTarget>();
  return row ?? undefined;
}

/** Inserts the attempt and keeps only the newest WEBHOOK_DELIVERIES_KEPT rows of the webhook. */
async function recordDelivery(
  runtime: WebhookRuntime,
  webhookId: string,
  eventType: string,
  attempt: DeliveryAttempt,
): Promise<void> {
  const { db } = runtime;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO webhook_deliveries (id, webhook_id, event, status, duration_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          randomId(),
          webhookId,
          eventType,
          attempt.status,
          attempt.durationMs,
          (runtime.now ?? Date.now)(),
        ),
      db
        .prepare(
          `DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (
             SELECT id FROM webhook_deliveries WHERE webhook_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?)`,
        )
        .bind(webhookId, webhookId, WEBHOOK_DELIVERIES_KEPT),
    ]);
  } catch (error) {
    // The webhook may have been deleted meanwhile (its rows cascade away). Delivery still counts.
    console.warn(JSON.stringify({ event: "webhook_record_failed", error: (error as Error).name }));
  }
}
