import type { WebhookRuntime } from "@emojisense/platform";
import { withAnswerStore } from "./answer-store.ts";
import { authenticate, KeyResolver, type Principal } from "./auth.ts";
import { type CacheLike, createMetering, type Handler } from "./context.ts";
import {
  CULTURE_PATH_PREFIX,
  type CultureOverride,
  createCultureOverride,
  createCultureRoute,
} from "./culture-admin/route.ts";
import { CustomEmojiIndex } from "./custom.ts";
import { CUSTOM_IMAGE_PATH, handleCustomImage, handleCustomPack } from "./custom-routes.ts";
import type { CustomEmojiReader } from "./custom-store.ts";
import type { Env } from "./env.ts";
import { handleEvents } from "./events.ts";
import { corsHeaders, errorResponse, json, refusesPlainHttp } from "./http.ts";
import { handleClassifyImage } from "./image.ts";
import { Meter, type WaitUntil } from "./meter.ts";
import { QueryStats } from "./query-stats.ts";
import { handleReactions } from "./reactions.ts";
import { handleSearch, searchCacheKey } from "./search.ts";
import { type Catalog, embeddingBinding, modelTag } from "./semantic.ts";
import { authorizeEmojiSets } from "./sets/access.ts";
import { createEmojiSetsRoute, type EmojiSetsOptions, SETS_PATH_PREFIX } from "./sets/route.ts";
import { createShardRoute, SHARDS_PATH_PREFIX } from "./shards/route.ts";
import type { Store } from "./store.ts";
import { handleTenants, isTenantsPath } from "./tenants.ts";
import { ServerTiming } from "./timing.ts";
import { alertUsageThresholds } from "./usage-alerts.ts";

export interface AppOptions {
  catalog: Catalog;
  /** A function, because `caches.default` exists only inside the Workers runtime. */
  cache: () => CacheLike;
  /** The usage and key store for this environment; undefined = dev keys only, memory metering. */
  store?: (env: Env) => Store | undefined;
  /** Hosted emoji sets (`/v1/sets/*`); undefined answers 404. */
  emojiSets?: EmojiSetsOptions;
  /** Custom emoji rows (images come from env.EMOJI); undefined = no custom emoji. */
  customEmoji?: (env: Env) => CustomEmojiReader | undefined;
  now?: () => number;
  /** Outgoing webhook requests. Defaults to the global fetch; tests replace it. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The wait between webhook retries. Tests replace it. */
  sleep?: (ms: number) => Promise<void>;
  /** The published culture build (R2) to serve at /v1/culture/*; shared with the search API's reader. */
  cultureOverride?: CultureOverride;
}

interface Route {
  method: "GET" | "POST";
  handle: Handler;
  /** The caller's edge-cache entry of the request, when it has one (see `lookAhead`). */
  cacheKey?: (url: URL, catalog: Catalog, caller: Principal) => Request | undefined;
}

const ROUTES: Record<string, Route> = {
  "/v1/search": { method: "GET", handle: handleSearch, cacheKey: searchCacheKey },
  "/v1/suggest-reactions": { method: "POST", handle: handleReactions },
  "/v1/classify-image": { method: "POST", handle: handleClassifyImage },
  "/v1/custom-pack": { method: "GET", handle: handleCustomPack },
  "/v1/events": { method: "POST", handle: handleEvents },
};

/** Hosts that only take client reports (stats.emojisense.*): a separate name, so they can move. */
const STATS_HOST = /^stats\./;

/**
 * The API Worker. Key cache and usage counters live as long as the isolate, so they are built
 * once, on the first request (bindings are only known then).
 */
export function createApp(options: AppOptions) {
  const { catalog } = options;
  const emojiSets = options.emojiSets ? createEmojiSetsRoute(options.emojiSets) : undefined;
  const shards = createShardRoute({ config: catalog.config, ...(options.now ? { now: options.now } : {}) });
  const { packVersion } = catalog.config;
  const culture = createCultureRoute({
    packVersion,
    override:
      options.cultureOverride ??
      createCultureOverride({ packVersion, ...(options.now ? { now: options.now } : {}) }),
  });
  let services:
    | { resolver: KeyResolver; meter: Meter; queryStats: QueryStats; custom: CustomEmojiIndex }
    | undefined;
  const servicesFor = (env: Env) => {
    if (!services) {
      const store = options.store?.(env);
      const now = options.now;
      services = {
        resolver: new KeyResolver({ store, devKeys: env.DEV_KEYS, ...(now ? { now } : {}) }),
        meter: new Meter({
          store,
          ...(now ? { now } : {}),
          onFlushed: (flushed, ctx) => alertUsageThresholds(webhooksFor(env, ctx), flushed),
        }),
        queryStats: new QueryStats({ store, ...(now ? { now } : {}) }),
        custom: new CustomEmojiIndex({ reader: options.customEmoji?.(env), ...(now ? { now } : {}) }),
      };
    }
    return services;
  };

  /** Webhook delivery for one invocation; undefined without a database. */
  const webhooksFor = (env: Env, ctx: WaitUntil): WebhookRuntime | undefined => {
    if (!env.DB) return undefined;
    return {
      db: env.DB,
      fetch: options.fetch ?? ((url, init) => fetch(url, init)),
      waitUntil: (promise) => ctx.waitUntil(promise),
      allowLoopback: env.ENVIRONMENT === "development",
      ...(options.now ? { now: options.now } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    };
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
      if (refusesPlainHttp(url, env.ENVIRONMENT)) {
        return errorResponse(403, `use https://${url.host}: plain http would send keys and text unencrypted`);
      }
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      if (STATS_HOST.test(url.hostname) && url.pathname !== "/v1/events")
        return errorResponse(404, "not found");

      if (url.pathname === "/v1/health") {
        if (request.method !== "GET") return errorResponse(405, "method not allowed", { Allow: "GET" });
        return json({
          ok: true,
          packVersion: catalog.config.packVersion,
          model: modelTag(catalog),
          semantic: Boolean(embeddingBinding(env)),
        });
      }
      // Hosted set images: a key on a plan with sets, not metered, not rate limited per call (a
      // picker loads hundreds of them).
      if (url.pathname.startsWith(SETS_PATH_PREFIX)) {
        if (!emojiSets) return errorResponse(404, "not found");
        const refused = await authorizeEmojiSets(request, url, env, servicesFor(env).resolver);
        return refused ?? emojiSets(request, url, ctx, options.cache());
      }
      // Layer-2 shards: public files like the images, edge-cached.
      if (url.pathname.startsWith(SHARDS_PATH_PREFIX)) return shards(request, url, env, ctx, options.cache());
      // Culture files: the published R2 build, else the deployed files. Public, edge-cached.
      if (url.pathname.startsWith(CULTURE_PATH_PREFIX))
        return culture(request, url, env, ctx, options.cache());
      // Custom emoji images are `<img src>` targets too, edge-cached.
      const image = CUSTOM_IMAGE_PATH.exec(url.pathname);
      if (image) {
        if (request.method !== "GET") return errorResponse(405, "method not allowed", { Allow: "GET" });
        const [, appId = "", emojiId = ""] = image;
        const { custom } = servicesFor(env);
        return handleCustomImage(request, env, ctx, { cache: options.cache(), custom }, { appId, emojiId });
      }
      if (isTenantsPath(url.pathname)) {
        const principal = await authenticate(request, url, env, servicesFor(env).resolver);
        if (principal instanceof Response) return principal;
        return handleTenants({
          request,
          url,
          env,
          principal,
          webhooks: webhooksFor(env, ctx),
          now: options.now ?? Date.now,
          cache: options.cache(),
        });
      }
      const route = ROUTES[url.pathname];
      if (!route) return errorResponse(404, "not found");
      if (request.method !== route.method) {
        return errorResponse(405, "method not allowed", { Allow: `${route.method}, OPTIONS` });
      }

      const { resolver, meter, queryStats, custom } = servicesFor(env);
      const timing = new ServerTiming();
      const authStarted = Date.now();
      const principal = await authenticate(request, url, env, resolver);
      timing.add("auth", Date.now() - authStarted);
      if (principal instanceof Response) return principal;
      // The edge cache is partitioned by account, so its lookup waits for the key check. It then
      // runs while the route reads the rest (custom emoji, culture, usage).
      const early = route.cacheKey?.(url, catalog, principal);
      // Search answers may also be shared across data centers through R2 (off by default).
      const shared =
        route.cacheKey && env.ANSWER_CACHE_ENABLED === "true" && env.SHARDS
          ? withAnswerStore(options.cache(), env.SHARDS, ctx)
          : options.cache();
      const cache = early ? lookAhead(shared, early, timing) : shared;
      const metering = createMetering(principal, meter, queryStats, ctx);
      return route.handle(request, env, ctx, { catalog, cache, custom, timing }, metering, principal);
    },
  };
}

/**
 * A cache whose lookup of `key` started now: `match(key)` later answers from that lookup, any
 * other request is looked up as usual. The lookup's duration is the `cache` stage.
 */
function lookAhead(cache: CacheLike, key: Request, timing: ServerTiming): CacheLike {
  const started = Date.now();
  const pending = cache.match(key).finally(() => timing.add("cache", Date.now() - started));
  // Unused when the route answers before its lookup (a bad parameter): no unhandled failure.
  pending.catch(() => {});
  return {
    match: (request) => (request.url === key.url ? pending : cache.match(request)),
    put: (request, response) => cache.put(request, response),
    delete: (url) => cache.delete(url),
  };
}
