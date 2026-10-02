import { METRICS, type Metric, PLANS, type PlanId } from "@emojisense/platform";
import { vi } from "vitest";
import type {
  AppSummary,
  BillingResponse,
  BillingSubscription,
  KeySummary,
  MeResponse,
  UsageResponse,
} from "../../src/shared/contract";
import { measureUsage, toPlanSummary } from "../../src/worker/plans";

export const NOW = Date.UTC(2026, 9, 15, 12);
export const FULL_KEY = "pk_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345";

export const APP: AppSummary = {
  id: "app_1",
  name: "Chat app",
  environment: "prod",
  plan: "free",
  emojiSet: "native",
  createdAt: Date.UTC(2026, 7, 3),
  activeKeyCount: 0,
  role: "owner",
  ownerId: "acc_1",
  ownerName: "Ada",
};

export const KEY: KeySummary = {
  id: "key_1",
  appId: "app_1",
  kind: "publishable",
  prefix: "pk_live_AbCd",
  allowedOrigins: ["https://chat.example.com"],
  createdAt: NOW,
  revokedAt: null,
};

export function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    account: { id: "acc_1", name: "Ada", email: "ada@example.com", signIn: "clerk", createdAt: NOW },
    plan: toPlanSummary(PLANS.free),
    appCount: 1,
    billingStatus: "none",
    teams: [],
    ...overrides,
  };
}

/** `GET /api/billing` for an account on `planId` with Whop set up and nothing used yet. */
export function billing(
  planId: PlanId = "free",
  subscription: Partial<BillingSubscription> = {},
  overrides: Partial<BillingResponse> = {},
): BillingResponse {
  const plan = PLANS[planId];
  return {
    plan: toPlanSummary(plan),
    period: "2026-10",
    usage: METRICS.map((metric) => measureUsage(metric, 0, plan.limits[metric])),
    limits: { semantic_calls: 1, image_classifications: 1, custom_emoji: 0, apps: 1 },
    appCount: 1,
    provider: "whop",
    subscription: {
      status: planId === "free" ? "none" : "active",
      interval: planId === "free" ? null : "month",
      currentPeriodEnd: planId === "free" ? null : Date.UTC(2026, 10, 15, 12),
      graceUntil: null,
      manageUrl: planId === "free" ? null : "https://whop.com/billing/manage/mber_test/",
      ...subscription,
    },
    purchasable: { solo: ["month", "year"], pro: ["month"], scale: ["month"] },
    ...overrides,
  };
}

/** `counts` are the account's; this app has all of them unless `appCounts` says otherwise. */
export function usage(
  period: string,
  counts: Partial<Record<Metric, number>> = {},
  appCounts: Partial<Record<Metric, number>> = counts,
  planId: PlanId = "free",
): UsageResponse {
  const plan = PLANS[planId];
  return {
    appId: APP.id,
    period,
    plan: { id: plan.id, name: plan.name },
    metrics: METRICS.map((metric) => ({
      ...measureUsage(metric, counts[metric] ?? 0, plan.limits[metric]),
      appUsed: appCounts[metric] ?? 0,
    })),
  };
}

interface FakeRequest {
  url: URL;
  body: unknown;
}
type FakeResult = { status?: number; body: unknown };
type Route = ((request: FakeRequest) => FakeResult) | { body: unknown; status?: number };

export interface Call {
  method: string;
  path: string;
  body?: unknown;
  /** The Authorization header, when the request had one (Clerk's bearer token). */
  authorization?: string;
}

/** Stubs fetch with "METHOD /path" routes and records every call. */
export function stubApi(routes: Record<string, Route>): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, window.location.origin);
    const method = init.method ?? "GET";
    const body =
      init.body instanceof FormData
        ? init.body
        : init.body
          ? (JSON.parse(String(init.body)) as unknown)
          : undefined;
    const authorization = new Headers(init.headers).get("authorization");
    calls.push({
      method,
      path: url.pathname + url.search,
      ...(body === undefined ? {} : { body }),
      ...(authorization ? { authorization } : {}),
    });
    const route = routes[`${method} ${url.pathname}`];
    const result: FakeResult = !route
      ? {
          status: 404,
          body: { error: { code: "not_found", message: `No fake for ${method} ${url.pathname}` } },
        }
      : typeof route === "function"
        ? route({ url, body })
        : route;
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls };
}

export const ok = (body: unknown) => ({ body });
export const unauthorized = {
  status: 401,
  body: { error: { code: "unauthorized", message: "Sign in to continue." } },
};
