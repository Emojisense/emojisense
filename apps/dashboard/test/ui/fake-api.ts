import { METRICS, type Metric, PLANS } from "@emojisense/platform";
import { vi } from "vitest";
import type { AppSummary, KeySummary, MeResponse, UsageResponse } from "../../src/shared/contract";
import { measureUsage, toPlanSummary } from "../../src/worker/plans";

export const NOW = Date.UTC(2026, 9, 15, 12);
export const FULL_KEY = "pk_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345";

export const APP: AppSummary = {
  id: "app_1",
  name: "Chat app",
  environment: "prod",
  plan: "free",
  createdAt: Date.UTC(2026, 7, 3),
  activeKeyCount: 0,
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
    account: { id: "acc_1", name: "Ada", email: "ada@example.com", githubLinked: true, createdAt: NOW },
    plan: toPlanSummary(PLANS.free),
    appCount: 1,
    waitlistPlan: null,
    ...overrides,
  };
}

export function usage(period: string, counts: Partial<Record<Metric, number>> = {}): UsageResponse {
  return {
    appId: APP.id,
    period,
    plan: { id: "free", name: "Free" },
    metrics: METRICS.map((metric) => measureUsage(metric, counts[metric] ?? 0, PLANS.free.limits[metric])),
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
}

/** Stubs fetch with "METHOD /path" routes and records every call. */
export function stubApi(routes: Record<string, Route>): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, window.location.origin);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path: url.pathname + url.search, ...(body === undefined ? {} : { body }) });
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
