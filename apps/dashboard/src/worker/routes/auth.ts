/**
 * Clerk signs people in and out in the browser (src/app/auth), so the Worker has no sign-in
 * route for it. These routes are the local dev sign-in and its sign-out.
 */
import { randomId } from "@emojisense/platform";
import { clearDevCookie, DEV_LOGIN, devCookie, devEmail, devSignInAllowed } from "../auth";
import type { RequestContext } from "../env";
import { assertSameOrigin, HttpError, json, redirect } from "../http";

const AFTER_SIGN_IN = "/apps";

/**
 * Local development only: signs in as `<login>@dev.localhost` without Clerk. Each login is its own
 * account. Answers 404 unless ENVIRONMENT=development and the URL is localhost.
 */
export async function devSignIn(ctx: RequestContext): Promise<Response> {
  const { url, env, deps } = ctx;
  if (!devSignInAllowed(ctx)) {
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
  const row = await env.DB.prepare(
    `INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = accounts.name
     RETURNING id`,
  )
    .bind(randomId(), devEmail(login), login, deps.now())
    .first<{ id: string }>();
  if (!row) throw new Error("dev account upsert returned no row");
  return redirect(AFTER_SIGN_IN, [devCookie(url, row.id)]);
}

/** Clears the dev sign-in cookie. Clerk sessions end in the browser with Clerk's `signOut()`. */
export async function logout({ request, url }: RequestContext): Promise<Response> {
  assertSameOrigin(request, url);
  return json({ ok: true }, 200, { "set-cookie": clearDevCookie(url) });
}
