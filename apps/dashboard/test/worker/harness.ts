import type { PlanId } from "@emojisense/platform";
import { type Mock, vi } from "vitest";
import { handleRequest } from "../../src/worker/app";
import type { Deps, Env } from "../../src/worker/env";
import { FakeD1 } from "./d1-fake";

export const BASE = "http://localhost:8790";
export const WEBSITE = "https://www.emojisense.example";
/** 2026-10-15 12:00 UTC */
export const NOW = Date.UTC(2026, 9, 15, 12);

interface CallOptions {
  body?: unknown;
  /** A multipart body (custom emoji uploads) instead of JSON. */
  form?: FormData;
  cookie?: string;
  /** Defaults to the dashboard origin on writes (as browsers send it) and to none on GET. */
  origin?: string | null;
  headers?: Record<string, string>;
  base?: string;
}

export interface Harness {
  db: FakeD1;
  env: Env;
  clock: { now: number };
  fetchMock: Mock<Deps["fetch"]>;
  call(method: string, path: string, options?: CallOptions): Promise<Response>;
  /** Dev sign-in; returns the Cookie header value ("es_session=…"). */
  signIn(login?: string): Promise<string>;
  /** Awaits the work handed to `waitUntil` (webhook deliveries), including work it started. */
  settle(): Promise<void>;
}

export function createHarness(overrides: Partial<Env> = {}): Harness {
  const db = new FakeD1();
  const env: Env = { DB: db, ENVIRONMENT: "development", WEBSITE_ORIGINS: WEBSITE, ...overrides };
  const clock = { now: NOW };
  const fetchMock = vi.fn<Deps["fetch"]>(async () => {
    throw new Error("unexpected network call");
  });
  const background: Promise<unknown>[] = [];
  const deps: Deps = {
    fetch: fetchMock,
    now: () => clock.now,
    waitUntil: (promise) => void background.push(promise),
    // Webhook retries run at once in tests.
    sleep: async () => {},
  };
  async function settle(): Promise<void> {
    while (background.length > 0) await Promise.all(background.splice(0));
  }

  async function call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
    const base = options.base ?? BASE;
    const headers = new Headers(options.headers);
    if (options.cookie) headers.set("cookie", options.cookie);
    const origin = options.origin === undefined ? (method === "GET" ? null : base) : options.origin;
    if (origin) headers.set("origin", origin);
    let body: string | FormData | undefined = options.form;
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
    return handleRequest(new Request(`${base}${path}`, { method, headers, body }), env, deps);
  }

  async function signIn(login = "ada"): Promise<string> {
    return sessionCookieFrom(await call("GET", `/api/auth/dev?login=${login}`));
  }

  return { db, env, clock, fetchMock, call, signIn, settle };
}

export function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

export function sessionCookieFrom(response: Response): string {
  const cookie = setCookies(response).find((value) => value.startsWith("es_session="));
  if (!cookie) throw new Error(`no session cookie (status ${response.status})`);
  return cookie.split(";")[0] ?? "";
}

export async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Dev sign-in accounts have the email `<login>@dev.localhost`. */
export function accountIdOf(harness: Harness, login: string): string {
  const [row] = harness.db.rows<{ id: string }>(
    "SELECT id FROM accounts WHERE email = ?",
    `${login}@dev.localhost`,
  );
  if (!row) throw new Error(`no account for ${login}`);
  return row.id;
}

export function setPlan(harness: Harness, login: string, plan: PlanId): void {
  harness.db.exec("UPDATE accounts SET plan = ? WHERE email = ?", plan, `${login}@dev.localhost`);
}

/** Creates an invite through the API and returns the token from its link. */
export async function createInvite(
  harness: Harness,
  cookie: string,
  input: { role: string; email?: string; owner?: string },
): Promise<string> {
  const query = input.owner ? `?owner=${input.owner}` : "";
  const response = await harness.call("POST", `/api/team/invites${query}`, {
    cookie,
    body: { role: input.role, ...(input.email ? { email: input.email } : {}) },
  });
  if (response.status !== 201) throw new Error(`invite failed: ${response.status} ${await response.text()}`);
  const { url } = await body<{ url: string }>(response);
  return url.slice(url.lastIndexOf("/") + 1);
}

/** The member joins the owner's team with `role` (invite + accept). The owner needs Pro or Scale. */
export async function joinTeam(
  harness: Harness,
  ownerCookie: string,
  memberCookie: string,
  role: string,
): Promise<void> {
  const token = await createInvite(harness, ownerCookie, { role });
  const response = await harness.call("POST", `/api/invites/${token}/accept`, { cookie: memberCookie });
  if (response.status !== 200) throw new Error(`accept failed: ${response.status} ${await response.text()}`);
}

/** Creates an app through the API and returns its id. */
export async function createAppFor(
  harness: Harness,
  cookie: string,
  input: { name?: string; environment?: string } = {},
): Promise<string> {
  const response = await harness.call("POST", "/api/apps", {
    cookie,
    body: { name: input.name ?? "Chat app", environment: input.environment ?? "prod" },
  });
  if (response.status !== 201)
    throw new Error(`create app failed: ${response.status} ${await response.text()}`);
  return (await body<{ app: { id: string } }>(response)).app.id;
}
