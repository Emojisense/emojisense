import { type CachePurger, expireLapsedBilling } from "@emojisense/platform";
import { handleRequest } from "./app";
import { createClerkGateway } from "./clerk";
import type { Env } from "./env";

/** Cloudflare's per-zone Cache API; the WebWorker lib types have no `caches.default`. */
const zoneCache = () => (caches as unknown as { default: CachePurger }).default;

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Wrapped, not passed as `fetch`: an unbound global fetch throws "Illegal invocation".
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      waitUntil: (promise) => ctx.waitUntil(promise),
      clerk: createClerkGateway,
      cache: zoneCache(),
    });
  },

  /**
   * Optional daily cron (a `triggers.crons` entry in wrangler.jsonc): moves subscriptions whose
   * past-due grace or cancelled period ran out to Free, in case Whop's final event never came.
   * Without it the same check runs on every Whop event and when the owner opens the dashboard.
   */
  scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      expireLapsedBilling(env.DB, Date.now()).then((changed) => {
        console.log(JSON.stringify({ event: "billing_lapsed_sweep", changed }));
      }),
    );
  },
};
