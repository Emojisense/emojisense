/**
 * Whop test values and a delivery helper. Signatures are made with node:crypto, independently of
 * the Worker's Web Crypto code, the way Whop's docs describe them: HMAC-SHA256 keyed with the
 * UTF-8 bytes of the whole `ws_…` secret, over `{id}.{timestamp}.{body}`, base64.
 */
import { createHmac } from "node:crypto";
import type { Env } from "../../src/worker/env";
import type { Harness } from "./harness";

/** A made-up test secret in Whop's format. */
export const WHOP_SECRET = "ws_test0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab";
export const WHOP_KEY = "whop_test_api_key";

export const WHOP_PLANS = {
  solo: { month: "plan_SoloMonth", year: "plan_SoloYear" },
  pro: { month: "plan_ProMonth" },
  scale: { month: "plan_ScaleMonth" },
};

/** The Worker env with Whop configured; ENVIRONMENT stays "development", the checkout `env` label. */
export const WHOP_ENV: Partial<Env> = {
  WHOP_API_BASE: "https://sandbox-api.whop.com/api/v1",
  WHOP_API_KEY: WHOP_KEY,
  WHOP_WEBHOOK_SECRET: WHOP_SECRET,
  WHOP_PLAN_IDS: JSON.stringify(WHOP_PLANS),
  WHOP_COMPANY_ID: "biz_test",
};

export function signWhop(secret: string, id: string, timestamp: string, body: string): string {
  const mac = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${body}`).digest();
  return `v1,${mac.toString("base64")}`;
}

let counter = 0;

export interface DeliveryOptions {
  id?: string;
  /** Unix seconds; defaults to the harness clock. */
  timestamp?: number;
  secret?: string;
  /** Replaces the computed signature header. */
  signature?: string;
  /** Sent instead of JSON.stringify(payload) (the signature still covers what is sent). */
  rawBody?: string;
  /** Changes the body after signing. */
  tamper?: (body: string) => string;
}

/** POSTs a signed Whop delivery to /api/whop/webhook, as Whop's servers do (no Origin, no session). */
export async function deliver(
  h: Harness,
  payload: unknown,
  options: DeliveryOptions = {},
): Promise<Response> {
  counter += 1;
  const id = options.id ?? `msg_test${counter}`;
  const timestamp = String(options.timestamp ?? Math.floor(h.clock.now / 1000));
  const body = options.rawBody ?? JSON.stringify(payload);
  const signature = options.signature ?? signWhop(options.secret ?? WHOP_SECRET, id, timestamp, body);
  return h.call("POST", "/api/whop/webhook", {
    origin: null,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    },
    rawBody: options.tamper ? options.tamper(body) : body,
  });
}

interface EventInput {
  /** ISO time of the event; defaults to the harness clock. */
  at?: number;
  data: Record<string, unknown>;
}

function envelope(h: Harness, type: string, { at, data }: EventInput) {
  return {
    id: `msg_env${counter}`,
    type,
    api_version: "v1",
    api_version_date: "2026-09-29",
    timestamp: new Date(at ?? h.clock.now).toISOString(),
    account_id: "biz_test",
    data,
  };
}

/** Checkout metadata as the Worker sends it. */
export function checkoutMetadata(accountId: string, plan: string, interval = "month", env = "development") {
  return { accountId, plan, interval, env };
}

/** A payment event in Whop's current shape. */
export function paymentEvent(
  h: Harness,
  type: "payment.succeeded" | "payment.failed",
  input: { membershipId: string; whopPlanId: string; metadata?: Record<string, unknown>; at?: number },
) {
  const at = input.at ?? h.clock.now;
  return envelope(h, type, {
    at,
    data: {
      id: `pay_${counter}`,
      status: type === "payment.succeeded" ? "paid" : "failed",
      membership_id: input.membershipId,
      plan_id: input.whopPlanId,
      product_id: "prod_test",
      metadata: input.metadata ?? null,
      paid_at: type === "payment.succeeded" ? new Date(at).toISOString() : null,
      created_at: new Date(at).toISOString(),
    },
  });
}

/** A membership event in Whop's current shape. */
export function membershipEvent(
  h: Harness,
  type: "membership.activated" | "membership.deactivated" | "membership.cancel_at_period_end_changed",
  input: {
    membershipId: string;
    whopPlanId: string;
    status?: string;
    metadata?: Record<string, unknown>;
    periodEnd?: number;
    cancelAtPeriodEnd?: boolean;
    manageUrl?: string | null;
    at?: number;
  },
) {
  return envelope(h, type, {
    at: input.at,
    data: {
      id: input.membershipId,
      status: input.status ?? (type === "membership.deactivated" ? "canceled" : "active"),
      plan_id: input.whopPlanId,
      product_id: "prod_test",
      metadata: input.metadata ?? {},
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
      current_period_end: input.periodEnd === undefined ? null : new Date(input.periodEnd).toISOString(),
      manage_url:
        input.manageUrl === undefined ? "https://whop.com/billing/manage/mber_test/" : input.manageUrl,
    },
  });
}
