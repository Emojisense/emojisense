import { handleRequest } from "./app";
import type { Env } from "./env";

export default {
  fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    // Wrapped, not passed as `fetch`: an unbound global fetch throws "Illegal invocation".
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
};
