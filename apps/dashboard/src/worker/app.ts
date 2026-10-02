import { findCaller } from "./auth";
import type { AuthedContext, Deps, Env, RequestContext } from "./env";
import { assertSameOrigin, errorJson, HttpError, json } from "./http";
import { createRouter, type Handler } from "./router";
import { getAnalytics } from "./routes/analytics";
import { createApp, getApp, listApps, updateApp } from "./routes/apps";
import { devSignIn, logout } from "./routes/auth";
import { getBilling, requestUpgrade } from "./routes/billing";
import { deleteEmoji, listEmoji, updateEmoji, uploadEmoji } from "./routes/emoji";
import { importDiscordEmoji, importSlackEmoji } from "./routes/emoji-import";
import { createKey, revokeKey, updateKey } from "./routes/keys";
import { deleteMe, getMe } from "./routes/me";
import { acceptInvite, createInvite, deleteInvite, getTeam, removeMember, updateMember } from "./routes/team";
import { createAppTenant, deleteAppTenant, getAppTenant, listAppTenants } from "./routes/tenants";
import { getUsage } from "./routes/usage";
import { joinWaitlist, waitlistPreflight } from "./routes/waitlist";
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  testWebhook,
  updateWebhook,
} from "./routes/webhooks";

/** Signed-in routes: same-origin writes, then a valid Clerk session (or dev sign-in), then the handler. */
function authed(handler: (ctx: AuthedContext) => Promise<Response>): Handler {
  return async (ctx) => {
    assertSameOrigin(ctx.request, ctx.url);
    const caller = await findCaller(ctx);
    if (!caller) throw new HttpError(401, "unauthorized", "Sign in to continue.");
    return handler({ ...ctx, ...caller });
  };
}

const route = createRouter([
  { method: "GET", path: "/api/auth/dev", handler: devSignIn },
  { method: "POST", path: "/api/auth/logout", handler: logout },
  { method: "GET", path: "/api/me", handler: authed(getMe) },
  { method: "DELETE", path: "/api/me", handler: authed(deleteMe) },
  { method: "GET", path: "/api/apps", handler: authed(listApps) },
  { method: "POST", path: "/api/apps", handler: authed(createApp) },
  { method: "GET", path: "/api/apps/:id", handler: authed(getApp) },
  { method: "PATCH", path: "/api/apps/:id", handler: authed(updateApp) },
  { method: "POST", path: "/api/apps/:id/keys", handler: authed(createKey) },
  { method: "GET", path: "/api/apps/:id/usage", handler: authed(getUsage) },
  { method: "GET", path: "/api/apps/:id/analytics", handler: authed(getAnalytics) },
  { method: "GET", path: "/api/apps/:id/emoji", handler: authed(listEmoji) },
  { method: "POST", path: "/api/apps/:id/emoji", handler: authed(uploadEmoji) },
  { method: "PATCH", path: "/api/apps/:id/emoji/:emojiId", handler: authed(updateEmoji) },
  { method: "DELETE", path: "/api/apps/:id/emoji/:emojiId", handler: authed(deleteEmoji) },
  { method: "POST", path: "/api/apps/:id/emoji/import/slack", handler: authed(importSlackEmoji) },
  { method: "POST", path: "/api/apps/:id/emoji/import/discord", handler: authed(importDiscordEmoji) },
  { method: "GET", path: "/api/apps/:id/tenants", handler: authed(listAppTenants) },
  { method: "POST", path: "/api/apps/:id/tenants", handler: authed(createAppTenant) },
  { method: "GET", path: "/api/apps/:id/tenants/:tenantId", handler: authed(getAppTenant) },
  { method: "DELETE", path: "/api/apps/:id/tenants/:tenantId", handler: authed(deleteAppTenant) },
  { method: "GET", path: "/api/apps/:id/webhooks", handler: authed(listWebhooks) },
  { method: "POST", path: "/api/apps/:id/webhooks", handler: authed(createWebhook) },
  { method: "PATCH", path: "/api/webhooks/:id", handler: authed(updateWebhook) },
  { method: "DELETE", path: "/api/webhooks/:id", handler: authed(deleteWebhook) },
  { method: "POST", path: "/api/webhooks/:id/test", handler: authed(testWebhook) },
  { method: "GET", path: "/api/webhooks/:id/deliveries", handler: authed(listWebhookDeliveries) },
  { method: "PATCH", path: "/api/keys/:id", handler: authed(updateKey) },
  { method: "DELETE", path: "/api/keys/:id", handler: authed(revokeKey) },
  { method: "GET", path: "/api/team", handler: authed(getTeam) },
  { method: "POST", path: "/api/team/invites", handler: authed(createInvite) },
  { method: "DELETE", path: "/api/team/invites/:id", handler: authed(deleteInvite) },
  { method: "PATCH", path: "/api/team/members/:id", handler: authed(updateMember) },
  { method: "DELETE", path: "/api/team/members/:id", handler: authed(removeMember) },
  { method: "POST", path: "/api/invites/:token/accept", handler: authed(acceptInvite) },
  { method: "GET", path: "/api/billing", handler: authed(getBilling) },
  { method: "POST", path: "/api/billing/upgrade", handler: authed(requestUpgrade) },
  { method: "POST", path: "/api/waitlist", handler: joinWaitlist },
  { method: "OPTIONS", path: "/api/waitlist", handler: waitlistPreflight },
]);

export async function handleRequest(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  // run_worker_first sends only /api/* here; anything else is a static asset or the SPA shell.
  if (!url.pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);

  const match = route(request.method, url.pathname);
  if (match.kind === "none") {
    return errorJson(
      new HttpError(404, "not_found", `No API route matches ${request.method} ${url.pathname}.`),
    );
  }
  if (match.kind === "wrong_method") {
    const allow = match.allowed.join(", ");
    return errorJson(new HttpError(405, "method_not_allowed", `Use ${allow} for ${url.pathname}.`), {
      allow,
    });
  }

  const ctx: RequestContext = { request, url, env, deps, params: match.params };
  try {
    return await match.route.handler(ctx);
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error);
    // Logs the route and the error only: no ids, emails, keys or IPs (docs/API.md, Privacy).
    console.error(
      JSON.stringify({
        level: "error",
        event: "unhandled_error",
        route: `${match.route.method} ${match.route.path}`,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return json(
      { error: { code: "internal_error", message: "Something went wrong on our side. Try again." } },
      500,
    );
  }
}
