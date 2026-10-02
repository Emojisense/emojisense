/**
 * Public Pro waitlist. The dashboard posts same-origin; the marketing website posts
 * cross-origin, so its origins (WEBSITE_ORIGINS) get CORS headers. No cookies are involved.
 */
import type { WaitlistResponse } from "../../shared/contract";
import type { Env, RequestContext } from "../env";
import { errorJson, HttpError, json, readJsonObject } from "../http";
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
    const body = await readJsonObject(request);
    const email = parseEmail(body.email);
    const plan = parseWaitlistPlan(body.plan);
    await env.DB.prepare(
      `INSERT INTO waitlist (email, plan, created_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET plan = excluded.plan`,
    )
      .bind(email, plan, deps.now())
      .run();
    const response: WaitlistResponse = { ok: true, plan };
    return json(response, 200, cors);
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error, cors);
    throw error;
  }
}
