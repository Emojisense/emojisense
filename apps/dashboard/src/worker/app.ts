import type { AuthedContext, Deps, Env, RequestContext } from "./env";
import { assertSameOrigin, errorJson, HttpError, json } from "./http";
import { createRouter, type Handler } from "./router";
import { createApp, getApp, listApps } from "./routes/apps";
import { devSignIn, finishGitHubSignIn, logout, startGitHubSignIn } from "./routes/auth";
import { createKey, revokeKey, updateKey } from "./routes/keys";
import { getMe } from "./routes/me";
import { getUsage } from "./routes/usage";
import { joinWaitlist, waitlistPreflight } from "./routes/waitlist";
import { findSessionAccount } from "./session";

/** Session-only routes: same-origin writes, then a valid session, then the handler. */
function authed(handler: (ctx: AuthedContext) => Promise<Response>): Handler {
  return async (ctx) => {
    assertSameOrigin(ctx.request, ctx.url);
    const account = await findSessionAccount(ctx.env.DB, ctx.request, ctx.deps.now());
    if (!account) throw new HttpError(401, "unauthorized", "Sign in to continue.");
    return handler({ ...ctx, account });
  };
}

const route = createRouter([
  { method: "GET", path: "/api/auth/github", handler: startGitHubSignIn },
  { method: "GET", path: "/api/auth/github/callback", handler: finishGitHubSignIn },
  { method: "GET", path: "/api/auth/dev", handler: devSignIn },
  { method: "POST", path: "/api/auth/logout", handler: logout },
  { method: "GET", path: "/api/me", handler: authed(getMe) },
  { method: "GET", path: "/api/apps", handler: authed(listApps) },
  { method: "POST", path: "/api/apps", handler: authed(createApp) },
  { method: "GET", path: "/api/apps/:id", handler: authed(getApp) },
  { method: "POST", path: "/api/apps/:id/keys", handler: authed(createKey) },
  { method: "GET", path: "/api/apps/:id/usage", handler: authed(getUsage) },
  { method: "PATCH", path: "/api/keys/:id", handler: authed(updateKey) },
  { method: "DELETE", path: "/api/keys/:id", handler: authed(revokeKey) },
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
