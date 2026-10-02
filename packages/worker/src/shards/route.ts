import { SHARD_INDEX_FILE, shardFileName } from "@emojisense/data/shards";
import {
  SHARD_EDGE_CACHE_SECONDS,
  SHARD_FILE_BROWSER_CACHE,
  SHARD_INDEX_BROWSER_CACHE,
  SHARD_MISSING_CACHE,
  SHARD_POINTER_TTL_MS,
} from "../config.ts";
import type { CacheLike } from "../context.ts";
import type { Env, GeneratedConfig } from "../env.ts";
import { corsHeaders, errorResponse } from "../http.ts";
import type { WaitUntil } from "../meter.ts";
import { readPointer, type ShardBucket, storePrefix } from "./storage.ts";

export const SHARDS_PATH_PREFIX = "/p/";
const SHARD_PATH = /^\/p\/([^/]+)\/([^/]+)$/;
const JSON_TYPE = "application/json; charset=utf-8";

/**
 * The stored name of a requested file: `index.json`, or `encodeURIComponent(key).json` whether
 * the client (or a proxy) sent the key encoded or not. Undefined for anything else.
 */
function storedName(segment: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  if (!decoded.endsWith(".json") || decoded.length > 256) return undefined;
  return decoded === SHARD_INDEX_FILE ? decoded : shardFileName(decoded.slice(0, -".json".length));
}

const missing = () => errorResponse(404, "not found", { "Cache-Control": SHARD_MISSING_CACHE });

/** The browser-facing copy: its own cache lifetime, CORS, conditional and HEAD requests. */
function present(request: Request, stored: Response, browserCache: string): Response {
  const etag = stored.headers.get("ETag");
  const headers = new Headers({ ...corsHeaders, "Content-Type": JSON_TYPE, "Cache-Control": browserCache });
  if (etag) headers.set("ETag", etag);
  if (etag && request.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : stored.body, { status: stored.status, headers });
}

export interface ShardRouteOptions {
  config: GeneratedConfig;
  now?: () => number;
}

/**
 * GET /p/<packVersion>/<file>: layer-2 shards (PACK_FORMAT §6). The nightly build (job.ts) writes
 * them to R2; this serves the build that the store's pointer names, through the edge cache
 * (keyed by build id, whose files never change). Without a build for this deployment's pack
 * version and data (no bucket, first night after a deploy, another pack version), the static
 * shards in public/p are served, if the deploy shipped any. Free for callers: no key, not metered.
 */
export function createShardRoute(options: ShardRouteOptions) {
  const { config } = options;
  const now = options.now ?? Date.now;
  const prefix = storePrefix(config.packVersion, config.contentHash);
  let pointer: { build: Promise<string | undefined>; until: number } | undefined;

  /** The served build id, read from R2 at most once per SHARD_POINTER_TTL_MS per isolate. */
  const currentBuild = (bucket: ShardBucket): Promise<string | undefined> => {
    if (!pointer || now() >= pointer.until) {
      const build = readPointer(bucket, prefix).then(
        (p) => p?.build,
        (error: unknown) => {
          console.warn(JSON.stringify({ event: "shards_pointer_failed", error: (error as Error).name }));
          pointer = undefined;
          return undefined;
        },
      );
      pointer = { build, until: now() + SHARD_POINTER_TTL_MS };
    }
    return pointer.build;
  };

  /** public/p, with the cache lifetime of a file that the next nightly build may replace. */
  const fromAssets = async (request: Request, env: Env): Promise<Response> => {
    const asset = await env.ASSETS?.fetch(request.url);
    if (!asset?.ok) return missing();
    return present(request, asset, SHARD_INDEX_BROWSER_CACHE);
  };

  return async (
    request: Request,
    url: URL,
    env: Env,
    ctx: WaitUntil,
    cache: CacheLike,
  ): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "method not allowed", { Allow: "GET, HEAD, OPTIONS" });
    }
    const match = SHARD_PATH.exec(url.pathname);
    const name = match && storedName(match[2] as string);
    if (!match || !name) return missing();

    const bucket = env.SHARDS;
    const build = bucket && match[1] === config.packVersion ? await currentBuild(bucket) : undefined;
    if (!bucket || !build) return fromAssets(request, env);

    const browserCache = name === SHARD_INDEX_FILE ? SHARD_INDEX_BROWSER_CACHE : SHARD_FILE_BROWSER_CACHE;
    const cacheKey = new Request(`${url.origin}/p/${config.packVersion}/${build}/${name}`);
    const hit = await cache.match(cacheKey);
    if (hit) return present(request, hit, browserCache);

    const object = await bucket.get(`${prefix}${build}/${name}`);
    if (!object) return missing();
    const stored = new Response(await object.text(), {
      headers: {
        "Content-Type": JSON_TYPE,
        "Cache-Control": `public, max-age=${SHARD_EDGE_CACHE_SECONDS}`,
        ETag: object.httpEtag,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, stored.clone()));
    return present(request, stored, browserCache);
  };
}
