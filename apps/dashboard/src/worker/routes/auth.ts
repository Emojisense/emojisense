/**
 * Sign-in routes are browser navigations, not fetch calls, so failures redirect to the sign-in
 * page with an `error` code that the SPA turns into a message.
 */
import { randomId } from "@emojisense/platform";
import { isLocalhost, readCookie, serializeCookie } from "../cookies";
import { randomToken } from "../crypto";
import type { D1Database } from "../d1";
import type { RequestContext } from "../env";
import {
  authorizeUrl,
  callbackUrl,
  fetchGitHubProfile,
  type GitHubProfile,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_TTL_SECONDS,
} from "../github";
import { assertSameOrigin, HttpError, json, redirect } from "../http";
import { clearSessionCookie, createSession, deleteSession, sessionCookie } from "../session";

const AFTER_SIGN_IN = "/apps";
const DEV_LOGIN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function stateCookie(url: URL, value: string, maxAgeSeconds: number): string {
  return serializeCookie(STATE_COOKIE, value, { maxAgeSeconds, path: STATE_COOKIE_PATH, url });
}

export async function startGitHubSignIn({ url, env }: RequestContext): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return redirect("/?error=github_unconfigured");
  const state = randomToken(16);
  return redirect(authorizeUrl(env.GITHUB_CLIENT_ID, callbackUrl(url), state), [
    stateCookie(url, state, STATE_TTL_SECONDS),
  ]);
}

export async function finishGitHubSignIn({ request, url, env, deps }: RequestContext): Promise<Response> {
  const clearState = stateCookie(url, "", 0);
  const fail = (code: string) => redirect(`/?error=${code}`, [clearState]);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail("github_unconfigured");
  if (url.searchParams.has("error")) return fail("github_denied");

  // The state cookie ties the callback to the browser that started the sign-in (login CSRF).
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expected = readCookie(request, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return fail("github_state");

  let profile: GitHubProfile;
  try {
    profile = await fetchGitHubProfile(deps.fetch, {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      code,
      redirectUri: callbackUrl(url),
    });
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", event: "github_sign_in_failed", message: (error as Error).message }),
    );
    return fail("github_failed");
  }

  const now = deps.now();
  const accountId = await upsertGitHubAccount(env.DB, profile, now);
  const token = await createSession(env.DB, accountId, now);
  return redirect(AFTER_SIGN_IN, [clearState, sessionCookie(token, url)]);
}

async function emailTaken(db: D1Database, email: string, githubId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS taken FROM accounts WHERE email = ? AND github_id IS NOT ?")
    .bind(email, githubId)
    .first();
  return row !== null;
}

/**
 * Accounts are keyed by GitHub user id, never linked by email. An email that another account
 * already uses is left out instead of failing the sign-in on the UNIQUE constraint.
 */
async function upsertGitHubAccount(db: D1Database, profile: GitHubProfile, now: number): Promise<string> {
  const email = profile.email && !(await emailTaken(db, profile.email, profile.id)) ? profile.email : null;
  const row = await db
    .prepare(
      `INSERT INTO accounts (id, email, github_id, name, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET name = excluded.name, email = COALESCE(excluded.email, accounts.email)
       RETURNING id`,
    )
    .bind(randomId(), email, profile.id, profile.name, now)
    .first<{ id: string }>();
  if (!row) throw new Error("account upsert returned no row");
  return row.id;
}

/**
 * Local development only: signs in as `<login>@dev.localhost` without GitHub. Both the
 * environment flag and a localhost URL are required, so one wrong production var cannot open it.
 */
export async function devSignIn({ url, env, deps }: RequestContext): Promise<Response> {
  if (env.ENVIRONMENT !== "development" || !isLocalhost(url)) {
    throw new HttpError(
      404,
      "not_found",
      "Dev sign-in works only on localhost with ENVIRONMENT=development.",
    );
  }
  const login = (url.searchParams.get("login") ?? "dev").trim().toLowerCase();
  if (!DEV_LOGIN.test(login)) {
    throw new HttpError(400, "invalid_request", "login must be 1–32 letters, digits or hyphens.", "login");
  }
  const now = deps.now();
  const row = await env.DB.prepare(
    `INSERT INTO accounts (id, email, github_id, name, created_at) VALUES (?, ?, NULL, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = accounts.name
     RETURNING id`,
  )
    .bind(randomId(), `${login}@dev.localhost`, login, now)
    .first<{ id: string }>();
  if (!row) throw new Error("dev account upsert returned no row");
  const token = await createSession(env.DB, row.id, now);
  return redirect(AFTER_SIGN_IN, [sessionCookie(token, url)]);
}

export async function logout({ request, url, env }: RequestContext): Promise<Response> {
  assertSameOrigin(request, url);
  await deleteSession(env.DB, request);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(url) });
}
