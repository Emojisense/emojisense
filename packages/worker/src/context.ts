import type { Metric } from "@emojisense/platform";
import type { Principal } from "./auth.ts";
import type { CustomEmojiIndex } from "./custom.ts";
import type { Env } from "./env.ts";
import type { Meter, WaitUntil } from "./meter.ts";
import type { QueryStats, SearchRegion } from "./query-stats.ts";
import type { Catalog } from "./semantic.ts";
import type { ServerTiming } from "./timing.ts";

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  /** Purges custom emoji images when they are deleted (this data center only). */
  delete(url: string): Promise<boolean>;
}

/**
 * Plan limits, usage and search analytics for the caller of one request. Anonymous callers are
 * never limited or counted.
 */
export interface Metering {
  /**
   * True when the key's account has used this month's plan limit for the metric. The limit
   * belongs to the account, so the calls of all of its apps count.
   */
  overLimit(metric: Metric): Promise<boolean>;
  /**
   * `overLimit` without waiting, from what this isolate last read of the account's usage: `fresh`
   * when that read is recent enough for `overLimit` to answer without a new one. Undefined when
   * the usage was never read here.
   */
  peekOverLimit(metric: Metric): { overLimit: boolean; fresh: boolean } | undefined;
  /** Count one billable call for the key's app and start a batched flush when one is due. */
  count(metric: Metric): void;
  /**
   * Add one search to the app's analytics (query_daily): the normalized query, how many results
   * the caller got (0 = a miss), its locale and the request's country. Only for keys with an apps row.
   */
  recordSearch(query: string, resultCount: number, region: SearchRegion): void;
}

export interface Deps {
  catalog: Catalog;
  cache: CacheLike;
  /** Per-isolate custom emoji of the caller's app (search merge, custom pack). */
  custom: CustomEmojiIndex;
  /** Stage durations of this request, for its Server-Timing header. */
  timing: ServerTiming;
}

export type Handler = (
  request: Request,
  env: Env,
  ctx: WaitUntil,
  deps: Deps,
  metering: Metering,
  /** Who is calling: a key (and its app) or anonymous. */
  caller: Principal,
) => Promise<Response>;

export function createMetering(
  principal: Principal,
  meter: Meter,
  queryStats: QueryStats,
  ctx: WaitUntil,
): Metering {
  if (principal.kind === "anonymous") {
    return {
      overLimit: async () => false,
      peekOverLimit: () => ({ overLimit: false, fresh: true }),
      count: () => {},
      recordSearch: () => {},
    };
  }
  const { key, plan, persistUsage } = principal;
  return {
    async overLimit(metric) {
      return (await meter.accountCount(key.accountId, metric)) >= plan.limits[metric];
    },
    peekOverLimit(metric) {
      const known = meter.knownAccountCount(key.accountId, metric);
      return known && { overLimit: known.count >= plan.limits[metric], fresh: known.fresh };
    },
    count(metric) {
      meter.add(key, metric, persistUsage, plan.limits[metric]);
      meter.flushIfDue(ctx);
    },
    recordSearch(query, resultCount, region) {
      // Development keys have no apps row to attach analytics to, and no dashboard to show them.
      if (!persistUsage) return;
      queryStats.add(key.appId, query, resultCount, region);
      queryStats.flushIfDue(ctx);
    },
  };
}
