import { authenticate, KeyResolver } from "./auth.ts";
import { type CacheLike, createMetering, type Handler } from "./context.ts";
import type { Env } from "./env.ts";
import { corsHeaders, errorResponse, json } from "./http.ts";
import { handleClassifyImage } from "./image.ts";
import { Meter, type WaitUntil } from "./meter.ts";
import { QueryStats } from "./query-stats.ts";
import { handleReactions } from "./reactions.ts";
import { handleSearch } from "./search.ts";
import { type Catalog, modelTag } from "./semantic.ts";
import { createEmojiSetsRoute, type EmojiSetsOptions, SETS_PATH_PREFIX } from "./sets/route.ts";
import type { Store } from "./store.ts";

export interface AppOptions {
  catalog: Catalog;
  /** A function, because `caches.default` exists only inside the Workers runtime. */
  cache: () => CacheLike;
  /** The usage and key store for this environment; undefined = dev keys only, memory metering. */
  store?: (env: Env) => Store | undefined;
  /** Hosted emoji sets (`/v1/sets/*`); undefined answers 404. */
  emojiSets?: EmojiSetsOptions;
  now?: () => number;
}

const ROUTES: Record<string, { method: "GET" | "POST"; handle: Handler }> = {
  "/v1/search": { method: "GET", handle: handleSearch },
  "/v1/suggest-reactions": { method: "POST", handle: handleReactions },
  "/v1/classify-image": { method: "POST", handle: handleClassifyImage },
};

/**
 * The API Worker. Key cache and usage counters live as long as the isolate, so they are built
 * once, on the first request (bindings are only known then).
 */
export function createApp(options: AppOptions) {
  const { catalog } = options;
  const emojiSets = options.emojiSets ? createEmojiSetsRoute(options.emojiSets) : undefined;
  let services: { resolver: KeyResolver; meter: Meter; queryStats: QueryStats } | undefined;
  const servicesFor = (env: Env) => {
    if (!services) {
      const store = options.store?.(env);
      const now = options.now;
      services = {
        resolver: new KeyResolver({ store, devKeys: env.DEV_KEYS, ...(now ? { now } : {}) }),
        meter: new Meter({ store, ...(now ? { now } : {}) }),
        queryStats: new QueryStats({ store, ...(now ? { now } : {}) }),
      };
    }
    return services;
  };

  return {
    /** Exposed for tests: the per-isolate meter after the first request. */
    get meter() {
      return services?.meter;
    },
    /** Exposed for tests: the per-isolate search analytics after the first request. */
    get queryStats() {
      return services?.queryStats;
    },
    async fetch(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

      if (url.pathname === "/v1/health") {
        if (request.method !== "GET") return errorResponse(405, "method not allowed", { Allow: "GET" });
        return json({
          ok: true,
          packVersion: catalog.config.packVersion,
          model: modelTag(catalog),
          semantic: Boolean(env.AI),
        });
      }
      // Public images: no key, not metered, not rate limited (a picker loads hundreds of them).
      if (url.pathname.startsWith(SETS_PATH_PREFIX)) {
        return emojiSets ? emojiSets(request, url, ctx, options.cache()) : errorResponse(404, "not found");
      }
      const route = ROUTES[url.pathname];
      if (!route) return errorResponse(404, "not found");
      if (request.method !== route.method) {
        return errorResponse(405, "method not allowed", { Allow: `${route.method}, OPTIONS` });
      }

      const { resolver, meter, queryStats } = servicesFor(env);
      const principal = await authenticate(request, url, env, resolver);
      if (principal instanceof Response) return principal;
      const metering = createMetering(principal, meter, queryStats, ctx);
      return route.handle(request, env, ctx, { catalog, cache: options.cache() }, metering);
    },
  };
}
