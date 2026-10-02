/**
 * Public Pro waitlist. The dashboard posts same-origin; the marketing website posts
 * cross-origin, so its origins (WEBSITE_ORIGINS) get CORS headers. No cookies are involved.
 *
 * Without JavaScript, the website's form posts application/x-www-form-urlencoded. Browsers send
 * it without a CORS preflight, so the Origin check is what keeps other websites out. Such a post
 * (no `Accept: application/json`) is answered with a 303 back to the website's waitlist page,
 * `?status=ok|error`, because a JSON answer would replace the page.
 */
import { type WaitlistStatus, waitlistReturnUrl } from "@emojisense/platform";
import type { WaitlistResponse } from "../../shared/contract";
import type { Env, RequestContext } from "../env";
import {
  errorJson,
  HttpError,
  isFormBody,
  isJsonBody,
  json,
  readFormObject,
  readJsonObject,
  seeOther,
} from "../http";
import { parseEmail, parseWaitlistPlan } from "../validate";

function websiteOrigins(env: Env): string[] {
  return (env.WEBSITE_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (origin && websiteOrigins(env).includes(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return { vary: "Origin" };
}

/**
 * The website to send a form post back to: the posting website, or the first configured one when
 * a client sends no Origin. Undefined means "answer with JSON", which is also the answer to an
 * origin that may not post.
 */
function formReturnOrigin(request: Request, origin: string | null, env: Env): string | undefined {
  if (!isFormBody(request) || /\bapplication\/json\b/i.test(request.headers.get("accept") ?? "")) {
    return undefined;
  }
  const websites = websiteOrigins(env);
  if (origin === null) return websites[0];
  return websites.includes(origin) ? origin : undefined;
}

async function readWaitlistBody(request: Request): Promise<Record<string, unknown>> {
  if (isFormBody(request)) return readFormObject(request);
  if (isJsonBody(request)) return readJsonObject(request);
  throw new HttpError(
    415,
    "unsupported_media_type",
    "Send JSON (Content-Type: application/json) or a form (application/x-www-form-urlencoded).",
  );
}

export async function waitlistPreflight({ request, env }: RequestContext): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!origin || !websiteOrigins(env).includes(origin)) {
    return new Response(null, { status: 403, headers: { vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, env),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "access-control-max-age": "86400",
    },
  });
}

/**
 * Idempotent: a repeat keeps the first sign-up time and records the latest plan. The answer is
 * the same for new and known emails, so the endpoint does not reveal who is on the list.
 */
export async function joinWaitlist({ request, url, env, deps }: RequestContext): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, env);
  const returnTo = formReturnOrigin(request, origin, env);
  const backToWebsite = (website: string, status: WaitlistStatus) =>
    seeOther(waitlistReturnUrl(website, status), { vary: "Origin" });
  try {
    if (origin !== null && origin !== url.origin && !websiteOrigins(env).includes(origin)) {
      throw new HttpError(403, "forbidden_origin", "This website may not add emails to the waitlist.");
    }
    if (env.WAITLIST_LIMITER) {
      const { success } = await env.WAITLIST_LIMITER.limit({
        key: request.headers.get("cf-connecting-ip") ?? "anon",
      });
      if (!success) throw new HttpError(429, "rate_limited", "Too many requests. Try again in a minute.");
    }
    const body = await readWaitlistBody(request);
    const email = parseEmail(body.email);
    const plan = parseWaitlistPlan(body.plan);
    await env.DB.prepare(
      `INSERT INTO waitlist (email, plan, created_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET plan = excluded.plan`,
    )
      .bind(email, plan, deps.now())
      .run();
    if (returnTo) return backToWebsite(returnTo, "ok");
    const response: WaitlistResponse = { ok: true, plan };
    return json(response, 200, cors);
  } catch (error) {
    if (returnTo) {
      if (!(error instanceof HttpError)) {
        // The same record as app.ts: the route and the error only, never the email.
        console.error(
          JSON.stringify({
            level: "error",
            event: "unhandled_error",
            route: "POST /api/waitlist",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return backToWebsite(returnTo, "error");
    }
    if (error instanceof HttpError) return errorJson(error, cors);
    throw error;
  }
}
