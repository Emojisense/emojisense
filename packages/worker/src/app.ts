import type { WebhookRuntime } from "@emojisense/platform";
import { authenticate, KeyResolver } from "./auth.ts";
import { type CacheLike, createMetering, type Handler } from "./context.ts";
import { CustomEmojiIndex } from "./custom.ts";
import { CUSTOM_IMAGE_PATH, handleCustomImage, handleCustomPack } from "./custom-routes.ts";
import type { CustomEmojiReader } from "./custom-store.ts";
import type { Env } from "./env.ts";
import { corsHeaders, errorResponse, json, refusesPlainHttp } from "./http.ts";
import { handleClassifyImage } from "./image.ts";
import { Meter, type WaitUntil } from "./meter.ts";
import { QueryStats } from "./query-stats.ts";
import { handleReactions } from "./reactions.ts";
import { handleSearch } from "./search.ts";
import { type Catalog, modelTag } from "./semantic.ts";
import { createEmojiSetsRoute, type EmojiSetsOptions, SETS_PATH_PREFIX } from "./sets/route.ts";
import { createShardRoute, SHARDS_PATH_PREFIX } from "./shards/route.ts";
import type { Store } from "./store.ts";
import { handleTenants, isTenantsPath } from "./tenants.ts";
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
}

const ROUTES: Record<string, { method: "GET" | "POST"; handle: Handler }> = {
  "/v1/search": { method: "GET", handle: handleSearch },
  "/v1/suggest-reactions": { method: "POST", handle: handleReactions },
  "/v1/classify-image": { method: "POST", handle: handleClassifyImage },
  "/v1/custom-pack": { method: "GET", handle: handleCustomPack },
};

/**
 * The API Worker. Key cache and usage counters live as long as the isolate, so they are built
 * once, on the first request (bindings are only known then).
 */
export function createApp(options: AppOptions) {
  const { catalog } = options;
  const emojiSets = options.emojiSets ? createEmojiSetsRoute(options.emojiSets) : undefined;
  const shards = createShardRoute({ config: catalog.config, ...(options.now ? { now: options.now } : {}) });
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
      // Layer-2 shards: public files like the images, edge-cached.
      if (url.pathname.startsWith(SHARDS_PATH_PREFIX)) return shards(request, url, env, ctx, options.cache());
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
        });
      }
      const route = ROUTES[url.pathname];
      if (!route) return errorResponse(404, "not found");
      if (request.method !== route.method) {
        return errorResponse(405, "method not allowed", { Allow: `${route.method}, OPTIONS` });
      }

      const { resolver, meter, queryStats, custom } = servicesFor(env);
      const principal = await authenticate(request, url, env, resolver);
      if (principal instanceof Response) return principal;
      const metering = createMetering(principal, meter, queryStats, ctx);
      return route.handle(
        request,
        env,
        ctx,
        { catalog, cache: options.cache(), custom },
        metering,
        principal,
      );
    },
  };
}
