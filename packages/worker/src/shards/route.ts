import { LOCALE_CODES } from "@emojisense/data/locales";
import {
  cdnVersionDir,
  liveIndexDir,
  liveIndexPath,
  resolveFrom,
  SHARD_FILES_DIR,
  SHARD_INDEX_FILE,
  type ShardIndex,
} from "@emojisense/data/shards";
import {
  SHARD_EDGE_CACHE_SECONDS,
  SHARD_FILE_CACHE,
  SHARD_INDEX_BROWSER_CACHE,
  SHARD_KEY_FILE_BROWSER_CACHE,
  SHARD_MISSING_CACHE,
  SHARD_POINTER_TTL_MS,
} from "../config.ts";
import type { CacheLike } from "../context.ts";
import type { Env, GeneratedConfig } from "../env.ts";
import { corsHeaders, errorResponse } from "../http.ts";
import type { WaitUntil } from "../meter.ts";
import type { ShardBucket } from "./storage.ts";

export const SHARDS_PATH_PREFIX = "/p/";
/** `/p/<packVersion>/<file>` (English), `/p/<packVersion>/<locale>/<file>` or `/p/<packVersion>/f/<file>`. */
const SHARD_PATH = /^\/p\/([^/]+)\/(?:([^/]+)\/)?([^/]+)$/;
const CONTENT_FILE = /^[0-9a-f]{16}\.json$/;
const PACK_LOCALES: ReadonlySet<string> = new Set(LOCALE_CODES);
const JSON_TYPE = "application/json; charset=utf-8";

/** The decoded key of a `<key>.json` segment, whether the client sent it encoded or not. */
function keyOf(segment: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return decoded.endsWith(".json") && decoded.length <= 256 ? decoded.slice(0, -".json".length) : undefined;
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
 * GET /p/<packVersion>/… on the API host: the files of the CDN bucket (PACK_FORMAT §6), for
 * clients that read shards here rather than on cdn.emojisense.*. Clients from before hashed files
 * ask for `<key>.json`: the live index maps it to the key's file. The nightly build (job.ts)
 * writes them. Without a bucket or a published file, the static shards in public/p are served, if
 * the deploy shipped any. Free for callers: no key, not metered.
 */
export function createShardRoute(options: ShardRouteOptions) {
  const { config } = options;
  const now = options.now ?? Date.now;
  /**
   * Live indexes by R2 key, each trusted for SHARD_POINTER_TTL_MS per isolate. They are not put
   * in the edge cache: their URL stays while the next build replaces them.
   */
  const indexes = new Map<string, { stored: Promise<StoredIndex | undefined>; until: number }>();

  const liveIndex = (bucket: ShardBucket, key: string): Promise<StoredIndex | undefined> => {
    const known = indexes.get(key);
    if (known && now() < known.until) return known.stored;
    const stored = bucket.get(key).then(
      async (object) => {
        if (!object) return undefined;
        const text = await object.text();
        return { text, etag: object.httpEtag, index: JSON.parse(text) as ShardIndex };
      },
      (error: unknown) => {
        console.warn(JSON.stringify({ event: "shards_index_failed", error: (error as Error).name }));
        indexes.delete(key);
        return undefined;
      },
    );
    indexes.set(key, { stored, until: now() + SHARD_POINTER_TTL_MS });
    return stored;
  };

  /** public/p, with the cache lifetime of a file that the next nightly build may replace. */
  const fromAssets = async (request: Request, env: Env): Promise<Response> => {
    const asset = await env.ASSETS?.fetch(request.url);
    if (!asset?.ok) return missing();
    return present(request, asset, SHARD_INDEX_BROWSER_CACHE);
  };

  /** A content-named file: never changes, so the edge keeps it for a week. */
  const contentFile = async (
    request: Request,
    url: URL,
    bucket: ShardBucket,
    objectKey: string,
    browserCache: string,
    ctx: WaitUntil,
    cache: CacheLike,
  ): Promise<Response> => {
    const cacheKey = new Request(`${url.origin}/__cdn/${objectKey}`);
    const hit = await cache.match(cacheKey);
    if (hit) return present(request, hit, browserCache);
    const object = await bucket.get(objectKey);
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
    if (!match) return missing();
    const [, packVersion, dir, segment] = match as unknown as [string, string, string | undefined, string];
    const bucket = env.CDN;
    if (!bucket || packVersion !== config.packVersion) return fromAssets(request, env);
    const versionDir = cdnVersionDir(packVersion);

    if (dir === SHARD_FILES_DIR.slice(0, -1)) {
      if (!CONTENT_FILE.test(segment)) return missing();
      return contentFile(
        request,
        url,
        bucket,
        `${versionDir}${SHARD_FILES_DIR}${segment}`,
        SHARD_FILE_CACHE,
        ctx,
        cache,
      );
    }
    // English is at the version root; `en/` is the same files.
    const locale = dir ?? "en";
    if (!PACK_LOCALES.has(locale)) return missing();
    const stored = await liveIndex(bucket, versionDir + liveIndexPath(locale));
    // No build of this version yet: the static shards, if the deploy shipped any.
    if (!stored) return fromAssets(request, env);
    if (segment === SHARD_INDEX_FILE) {
      const response = new Response(stored.text, { headers: { ETag: stored.etag } });
      return present(request, response, SHARD_INDEX_BROWSER_CACHE);
    }
    // A client from before hashed files: the live index maps its key to the key's file.
    const key = keyOf(segment);
    const files = stored.index.files ?? {};
    // Own keys only: "constructor" or "__proto__" must not resolve to Object.prototype members.
    const file = key !== undefined && Object.hasOwn(files, key) ? files[key] : undefined;
    if (file === undefined) return missing();
    const objectKey = versionDir + resolveFrom(liveIndexDir(locale), file);
    return contentFile(request, url, bucket, objectKey, SHARD_KEY_FILE_BROWSER_CACHE, ctx, cache);
  };
}

/** A live index as R2 holds it. */
interface StoredIndex {
  text: string;
  etag: string;
  index: ShardIndex;
}
