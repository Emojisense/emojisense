import type { PlanId } from "@emojisense/platform";
import { type Mock, vi } from "vitest";
import { handleRequest } from "../../src/worker/app";
import { DEV_COOKIE } from "../../src/worker/auth";
import type { ClerkFactory } from "../../src/worker/clerk";
import type { Deps, Env } from "../../src/worker/env";
import { FakeClerk } from "./clerk-fake";
import { FakeD1 } from "./d1-fake";

export const BASE = "http://localhost:8790";
export const WEBSITE = "https://www.emojisense.example";
/** 2026-10-15 12:00 UTC */
export const NOW = Date.UTC(2026, 9, 15, 12);

interface CallOptions {
  /** Sent as JSON with Content-Type: application/json. */
  body?: unknown;
  /** A multipart body (custom emoji uploads) instead of JSON. */
  form?: FormData;
  /** Sent as an HTML form (application/x-www-form-urlencoded), like a post without JavaScript. */
  urlencoded?: Record<string, string>;
  /** Sent byte for byte, with only the headers given (signed webhook deliveries). */
  rawBody?: string;
  /** A Cookie header value, or a `Bearer <token>` credential from `clerkSignIn`. */
  cookie?: string;
  /** A Clerk session token, sent as `Authorization: Bearer`. */
  token?: string;
  /** Defaults to the dashboard origin on writes (as browsers send it) and to none on GET. */
  origin?: string | null;
  headers?: Record<string, string>;
  base?: string;
}

export interface Harness {
  db: FakeD1;
  env: Env;
  /** The injected fake Clerk; `null` without Clerk or with a real gateway factory. */
  clerk: FakeClerk | null;
  clock: { now: number };
  fetchMock: Mock<Deps["fetch"]>;
  call(method: string, path: string, options?: CallOptions): Promise<Response>;
  /** Dev sign-in; returns the Cookie header value ("es_dev_account=…"). */
  signIn(login?: string): Promise<string>;
  /**
   * Clerk sign-in as `user_<login>` with the verified email `<login>@example.com`; the account
   * exists afterwards. Returns a `Bearer <token>` credential that `call` takes as `cookie`, so it
   * also works where dev sign-in does not (ENVIRONMENT other than development).
   */
  clerkSignIn(login?: string): Promise<string>;
  /** Awaits the work handed to `waitUntil` (webhook deliveries), including work it started. */
  settle(): Promise<void>;
  /** URLs deleted from the fake Cache API (`deps.cache`). */
  purged: string[];
}

interface HarnessOptions {
  /**
   * Defaults to a FakeClerk. `null` runs the Worker without Clerk (not configured); a factory
   * (e.g. the real `createClerkGateway`) is used as is.
   */
  clerk?: FakeClerk | ClerkFactory | null;
}

export function createHarness(overrides: Partial<Env> = {}, options: HarnessOptions = {}): Harness {
  const db = new FakeD1();
  const env: Env = { DB: db, ENVIRONMENT: "development", WEBSITE_ORIGINS: WEBSITE, ...overrides };
  const clerkOption = options.clerk === undefined ? new FakeClerk() : options.clerk;
  const clerk = clerkOption instanceof FakeClerk ? clerkOption : null;
  const clerkFactory: ClerkFactory = typeof clerkOption === "function" ? clerkOption : () => clerk;
  const clock = { now: NOW };
  const fetchMock = vi.fn<Deps["fetch"]>(async () => {
    throw new Error("unexpected network call");
  });
  const background: Promise<unknown>[] = [];
  const purged: string[] = [];
  const deps: Deps = {
    fetch: fetchMock,
    now: () => clock.now,
    waitUntil: (promise) => void background.push(promise),
    // Webhook retries run at once in tests.
    sleep: async () => {},
    clerk: clerkFactory,
    cache: { delete: async (url) => purged.push(url) > 0 },
  };
  async function settle(): Promise<void> {
    while (background.length > 0) await Promise.all(background.splice(0));
  }

  async function call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
    const base = options.base ?? BASE;
    const headers = new Headers(options.headers);
    if (options.cookie?.startsWith("Bearer ")) headers.set("authorization", options.cookie);
    else if (options.cookie) headers.set("cookie", options.cookie);
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    const origin = options.origin === undefined ? (method === "GET" ? null : base) : options.origin;
    if (origin) headers.set("origin", origin);
    let body: string | FormData | undefined = options.form ?? options.rawBody;
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    } else if (options.urlencoded !== undefined) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(options.urlencoded).toString();
    }
    return handleRequest(new Request(`${base}${path}`, { method, headers, body }), env, deps);
  }

  async function signIn(login = "ada"): Promise<string> {
    return devCookieFrom(await call("GET", `/api/auth/dev?login=${login}`));
  }

  async function clerkSignIn(login = "ada"): Promise<string> {
    if (!clerk) throw new Error("clerkSignIn needs the fake Clerk");
    const token = clerk.token({ userId: `user_${login}`, email: `${login}@example.com`, name: login });
    const response = await call("GET", "/api/me", { token });
    if (response.status !== 200) throw new Error(`Clerk sign-in failed: ${response.status}`);
    return `Bearer ${token}`;
  }

  return { db, env, clerk, clock, fetchMock, call, signIn, clerkSignIn, settle, purged };
}

export function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

export function devCookieFrom(response: Response): string {
  const cookie = setCookies(response).find((value) => value.startsWith(`${DEV_COOKIE}=`));
  if (!cookie) throw new Error(`no dev sign-in cookie (status ${response.status})`);
  return cookie.split(";")[0] ?? "";
}

export async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Dev sign-in accounts have the email `<login>@dev.localhost`; `clerkSignIn` ones the user `user_<login>`. */
const ACCOUNT_OF_LOGIN = "email = ? OR clerk_user_id = ?";

export function accountIdOf(harness: Harness, login: string): string {
  const [row] = harness.db.rows<{ id: string }>(
    `SELECT id FROM accounts WHERE ${ACCOUNT_OF_LOGIN}`,
    `${login}@dev.localhost`,
    `user_${login}`,
  );
  if (!row) throw new Error(`no account for ${login}`);
  return row.id;
}

export function setPlan(harness: Harness, login: string, plan: PlanId): void {
  harness.db.exec(
    `UPDATE accounts SET plan = ? WHERE ${ACCOUNT_OF_LOGIN}`,
    plan,
    `${login}@dev.localhost`,
    `user_${login}`,
  );
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
