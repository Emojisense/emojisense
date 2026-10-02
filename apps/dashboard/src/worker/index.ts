import { type CachePurger, expireLapsedBilling } from "@emojisense/platform";
import { handleRequest } from "./app";
import { createClerkGateway } from "./clerk";
import type { Env } from "./env";
import { cancelRetiredMemberships } from "./whop/memberships";

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
   * past-due grace or cancelled period ran out to Free, in case Whop's final event never came, and
   * retries cancelling retired memberships. Without it both also run after every Whop event.
   */
  scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): void {
    const deps = { fetch: (input: string, init?: RequestInit) => fetch(input, init), now: Date.now };
    ctx.waitUntil(
      Promise.all([expireLapsedBilling(env.DB, Date.now()), cancelRetiredMemberships(env, deps)]).then(
        ([changed, cancelled]) => {
          console.log(JSON.stringify({ event: "billing_sweep", changed, cancelled }));
        },
      ),
    );
  },
};
