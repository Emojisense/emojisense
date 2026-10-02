import type { CachePurger } from "@emojisense/platform";
import { handleRequest } from "./app";
import { createClerkGateway } from "./clerk";
import type { Env } from "./env";

/** Cloudflare's per-zone Cache API; the WebWorker lib types have no `caches.default`. */
const zoneCache = () => (caches as unknown as { default: CachePurger }).default;

export default {
  fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    // Wrapped, not passed as `fetch`: an unbound global fetch throws "Illegal invocation".
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      waitUntil: (promise) => ctx.waitUntil(promise),
      clerk: createClerkGateway,
      cache: zoneCache(),
    });
  },
};
