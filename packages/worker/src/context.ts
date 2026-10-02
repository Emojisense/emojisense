import type { Metric } from "@emojisense/platform";
import type { Principal } from "./auth.ts";
import type { Env } from "./env.ts";
import type { Meter, WaitUntil } from "./meter.ts";
import type { QueryStats } from "./query-stats.ts";
import type { Catalog } from "./semantic.ts";

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/**
 * Plan limits, usage and search analytics for the caller of one request. Anonymous callers are
 * never limited or counted.
 */
export interface Metering {
  overLimit(metric: Metric): Promise<boolean>;
  /** Count one billable call and start a batched flush when one is due. */
  count(metric: Metric): void;
  /**
   * Add one search to the app's analytics (query_daily): the normalized query and how many
   * results the caller got (0 = a miss). Only for keys with an apps row.
   */
  recordSearch(query: string, resultCount: number): void;
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

export function createMetering(
  principal: Principal,
  meter: Meter,
  queryStats: QueryStats,
  ctx: WaitUntil,
): Metering {
  if (principal.kind === "anonymous") {
    return { overLimit: async () => false, count: () => {}, recordSearch: () => {} };
  }
  const { key, plan, persistUsage } = principal;
  return {
    async overLimit(metric) {
      return (await meter.count(key.appId, metric)) >= plan.limits[metric];
    },
    count(metric) {
      meter.add(key.appId, metric, persistUsage, plan.limits[metric]);
      meter.flushIfDue(ctx);
    },
    recordSearch(query, resultCount) {
      // Development keys have no apps row to attach analytics to, and no dashboard to show them.
      if (!persistUsage) return;
      queryStats.add(key.appId, query, resultCount);
      queryStats.flushIfDue(ctx);
    },
  };
}
