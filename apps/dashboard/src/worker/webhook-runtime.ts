import type { WebhookRuntime } from "@emojisense/platform";
import type { RequestContext } from "./env";

/** Webhook delivery for one request: the dashboard's fetch, clock and `waitUntil`. */
export function webhookRuntime({ env, deps }: RequestContext): WebhookRuntime {
  return {
    db: env.DB,
    fetch: (url, init) => deps.fetch(url, init),
    // Without waitUntil (not a Worker invocation) the delivery still runs; it is just not awaited.
    waitUntil: deps.waitUntil ?? (() => {}),
    allowLoopback: isDevelopment(env.ENVIRONMENT),
    now: deps.now,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  };
}

export function isDevelopment(environment: string | undefined): boolean {
  return environment === "development";
}
