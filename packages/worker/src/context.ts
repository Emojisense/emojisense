import type { Metric } from "@emojisense/platform";
import type { Principal } from "./auth.ts";
import type { Env } from "./env.ts";
import type { Meter, WaitUntil } from "./meter.ts";
import type { Catalog } from "./semantic.ts";

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Plan limits and usage for the caller of one request. Anonymous callers are never limited. */
export interface Metering {
  overLimit(metric: Metric): Promise<boolean>;
  /** Count one billable call and start a batched flush when one is due. */
  count(metric: Metric): void;
}

export interface Deps {
  catalog: Catalog;
  cache: CacheLike;
}

export type Handler = (
  request: Request,
  env: Env,
  ctx: WaitUntil,
  deps: Deps,
  metering: Metering,
) => Promise<Response>;

export function createMetering(principal: Principal, meter: Meter, ctx: WaitUntil): Metering {
  if (principal.kind === "anonymous") {
    return { overLimit: async () => false, count: () => {} };
  }
  const { key, plan, persistUsage } = principal;
  return {
    async overLimit(metric) {
      return (await meter.count(key.appId, metric)) >= plan.limits[metric];
    },
    count(metric) {
      meter.add(key.appId, metric, persistUsage);
      meter.flushIfDue(ctx);
    },
  };
}
