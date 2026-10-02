/**
 * GET /v1/culture/<packVersion>/<file>: the culture files, from the published R2 build when there
 * is one for this deployment (approved live entries merged into the deployed files), else the
 * deployed static files (ASSETS), which stay the fallback. Same format (v1, 12 months) and the
 * same `Cache-Control: public, max-age=3600` either way. The search API reads its culture files
 * through the same override (`overrideCultureReader`), so the SDK files and `culture=1` agree.
 */
import { assertCulture, type Culture } from "emojisense";
import type { CacheLike } from "../context.ts";
import type { CultureReader } from "../culture.ts";
import type { Env } from "../env.ts";
import { corsHeaders, errorResponse } from "../http.ts";
import type { WaitUntil } from "../meter.ts";
import { CULTURE_EDGE_CACHE_SECONDS, CULTURE_FILE_BROWSER_CACHE, CULTURE_POINTER_TTL_MS } from "./config.ts";
import { readCultureFile, readCulturePointer, readDeployedIndex } from "./storage.ts";

export const CULTURE_PATH_PREFIX = "/v1/culture/";
const CULTURE_PATH = /^\/v1\/culture\/([^/]+)\/([^/]+)$/;
const CULTURE_FILE = /^(culture\.[a-z]{2,3}|index)\.json$/;
const JSON_TYPE = "application/json; charset=utf-8";

export interface CultureOverride {
  /** The published build to serve now, or undefined: serve the deployed files. */
  build(env: Env): Promise<string | undefined>;
}

/**
 * The served build: the R2 pointer (read at most once per CULTURE_POINTER_TTL_MS per isolate),
 * if it was made from this deployment's culture index. The deployed index never changes while an
 * isolate lives, so its hash is read once. Any failure means "no build": the deployed files.
 */
export function createCultureOverride(options: { packVersion: string; now?: () => number }): CultureOverride {
  const { packVersion } = options;
  const now = options.now ?? Date.now;
  let base: Promise<string | undefined> | undefined;
  let pointer: { build: Promise<string | undefined>; until: number } | undefined;

  const deployedBase = (env: Env) => {
    base ??= readDeployedIndex(env, packVersion).then(
      (deployed) => deployed?.base,
      (error: Error) => {
        base = undefined;
        console.warn(JSON.stringify({ event: "culture_index_unavailable", error: error.name }));
        return undefined;
      },
    );
    return base;
  };

  return {
    build(env) {
      const bucket = env.SHARDS;
      if (!bucket || !env.ASSETS) return Promise.resolve(undefined);
      if (!pointer || now() >= pointer.until) {
        const build = Promise.all([readCulturePointer(bucket, packVersion), deployedBase(env)]).then(
          ([served, current]) =>
            served?.build && current && served.base === current ? served.build : undefined,
          (error: Error) => {
            pointer = undefined;
            console.warn(JSON.stringify({ event: "culture_pointer_failed", error: error.name }));
            return undefined;
          },
        );
        pointer = { build, until: now() + CULTURE_POINTER_TTL_MS };
      }
      return pointer.build;
    },
  };
}

/** Culture files for `/v1/search?culture=1`: the published build, else the deployed file. */
export function overrideCultureReader(
  packVersion: string,
  override: CultureOverride,
  fallback: CultureReader,
): CultureReader {
  return async (file, env) => {
    const build = await override.build(env);
    if (!build || !env.SHARDS) return fallback(file, env);
    const stored = await readCultureFile(env.SHARDS, packVersion, build, file);
    if (!stored) return fallback(file, env);
    const culture: unknown = JSON.parse(stored.text);
    assertCulture(culture);
    return culture as Culture;
  };
}

/** The browser-facing copy: one cache lifetime, CORS, conditional and HEAD requests. */
function present(
  request: Request,
  body: ReadableStream | string | null,
  status: number,
  etag: string | null,
) {
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type": JSON_TYPE,
    "Cache-Control": CULTURE_FILE_BROWSER_CACHE,
    "X-Content-Type-Options": "nosniff",
  });
  if (etag) headers.set("ETag", etag);
  if (etag && request.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

export function createCultureRoute(options: { packVersion: string; override: CultureOverride }) {
  const { packVersion, override } = options;

  const fromAssets = async (request: Request, url: URL, env: Env): Promise<Response> => {
    const asset = await env.ASSETS?.fetch(`https://assets.local${url.pathname}`);
    if (!asset?.ok) return errorResponse(404, "not found", { "Cache-Control": "public, max-age=300" });
    return present(request, asset.body, 200, asset.headers.get("ETag"));
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
    const match = CULTURE_PATH.exec(url.pathname);
    if (!match || match[1] !== packVersion || !CULTURE_FILE.test(match[2] as string)) {
      return fromAssets(request, url, env);
    }
    const name = match[2] as string;
    const build = await override.build(env);
    if (!build || !env.SHARDS) return fromAssets(request, url, env);

    const cacheKey = new Request(`${url.origin}/v1/culture/${packVersion}/${build}/${name}`);
    const hit = await cache.match(cacheKey);
    if (hit) return present(request, hit.body, 200, hit.headers.get("ETag"));
    const stored = await readCultureFile(env.SHARDS, packVersion, build, name);
    if (!stored) return fromAssets(request, url, env);
    const edge = new Response(stored.text, {
      headers: {
        "Content-Type": JSON_TYPE,
        "Cache-Control": `public, max-age=${CULTURE_EDGE_CACHE_SECONDS}`,
        ETag: stored.etag,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, edge));
    return present(request, stored.text, 200, stored.etag);
  };
}
