import { lowestPlanWith, PLANS } from "@emojisense/platform";
import { clientIp, identify, isFirstPartyOrigin, type KeyResolver, keyRequired } from "../auth.ts";
import type { Env } from "../env.ts";
import { json } from "../http.ts";

/** The cheapest plan with hosted emoji sets. */
const SETS_PLAN = lowestPlanWith((plan) => plan.hostedEmojiSets) ?? "solo";

/**
 * Hosted emoji sets are a paid feature (`hostedEmojiSets` in PLANS): a set image needs a key whose
 * account plan includes them. A picker loads them as `<img src="…?key=pk_live_…">`, and an image
 * request sends no `Origin` header, so a publishable key is checked against the origin of the
 * `Referer` instead. Our own pages (FIRST_PARTY_ORIGINS: the website and the dashboard) need no
 * key. Not rate limited per call (a picker loads hundreds of images); key lookups that miss the
 * isolate cache are, like everywhere else. Undefined = allowed.
 */
export async function authorizeEmojiSets(
  request: Request,
  url: URL,
  env: Env,
  resolver: KeyResolver,
): Promise<Response | undefined> {
  const origin = request.headers.get("Origin") ?? originOf(request.headers.get("Referer"));
  const caller = await identify(request, url, env, resolver, { origin, ip: clientIp(request) });
  if (caller instanceof Response) return caller;
  if (caller.kind === "anonymous") {
    if (isFirstPartyOrigin(env, origin)) return undefined;
    if (caller.keyUnavailable) return keyRequired(caller, "hosted emoji sets");
    return setsError(
      401,
      "key_required",
      `Hosted emoji sets need a key on the ${PLANS[SETS_PLAN].name} plan or higher: add ?key=pk_live_….`,
    );
  }
  if (!caller.plan.hostedEmojiSets) {
    return setsError(
      402,
      "plan_required",
      `Hosted emoji sets need the ${PLANS[SETS_PLAN].name} plan or higher.`,
      { plan: SETS_PLAN },
    );
  }
  return undefined;
}

function originOf(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function setsError(status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ error, message, ...extra }, status, { "Cache-Control": "no-store" });
}
