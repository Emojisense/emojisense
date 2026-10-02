import { CUSTOM_EMOJI_CACHE_CONTROL } from "@emojisense/platform";
import { CUSTOM_PACK_CACHE_SECONDS, CUSTOM_PACK_CACHE_VERSION } from "./config.ts";
import type { CacheLike, Handler } from "./context.ts";
import { type CustomEmojiIndex, callerApp, imageOrigin, parseTenant } from "./custom.ts";
import { buildCustomPack } from "./custom-pack.ts";
import type { Env } from "./env.ts";
import { corsHeaders, errorResponse, json } from "./http.ts";
import type { WaitUntil } from "./meter.ts";

/** `/v1/custom/<appId>/<emojiId>`: both ids are random URL-safe strings. */
export const CUSTOM_IMAGE_PATH = /^\/v1\/custom\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/;

/**
 * Images are served from the API origin, so an SVG opened directly must not run anything even
 * if a check missed something: no scripts, no requests, sandboxed.
 */
const IMAGE_HEADERS = {
  "Cache-Control": CUSTOM_EMOJI_CACHE_CONTROL,
  "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GET /v1/custom/:appId/:emojiId. Public (it is an `<img src>`), no key and no metering. An id
 * always points at the same image, so the answer is immutable and served from the edge cache.
 */
export async function handleCustomImage(
  request: Request,
  env: Env,
  ctx: WaitUntil,
  deps: { cache: CacheLike; custom: CustomEmojiIndex },
  ids: { appId: string; emojiId: string },
): Promise<Response> {
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/v1/custom/${ids.appId}/${ids.emojiId}`);
  const hit = await deps.cache.match(cacheKey);
  if (hit) return hit;

  const reader = deps.custom.reader;
  if (!reader || !env.EMOJI) return errorResponse(404, "not found", { "Cache-Control": "no-store" });
  let object: R2ObjectBody | null = null;
  let contentType = "";
  try {
    const row = await reader.find(ids.appId, ids.emojiId);
    if (row) {
      object = await env.EMOJI.get(row.image_key);
      contentType = row.content_type;
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "custom_image_unavailable", error: (error as Error).name }));
    return errorResponse(503, "temporarily unavailable", { "Cache-Control": "no-store", "Retry-After": "5" });
  }
  if (!object) return errorResponse(404, "not found", { "Cache-Control": "no-store" });

  const response = new Response(object.body, {
    headers: {
      ...corsHeaders,
      ...IMAGE_HEADERS,
      "Content-Type": contentType,
      ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
    },
  });
  ctx.waitUntil(deps.cache.put(cacheKey, response.clone()));
  return response;
}

/**
 * GET /v1/custom-pack?key=…[&tenant=<externalId>]. The app's custom emoji (app-wide plus the
 * tenant's) as a pack (PACK_FORMAT.md §8). Needs a key; not metered. Cached at the edge for 60 s
 * per app, tenant and pack layout version, so edits show up within a minute.
 */
export const handleCustomPack: Handler = async (request, env, ctx, { cache, custom }, _metering, caller) => {
  if (caller.kind === "anonymous") return errorResponse(401, "a key is required for custom emoji");
  const url = new URL(request.url);
  const tenant = parseTenant(url.searchParams.get("tenant"));
  if (tenant === "invalid") return errorResponse(400, "tenant must be at most 128 characters");
  const headers = { "Cache-Control": `public, max-age=${CUSTOM_PACK_CACHE_SECONDS}` };

  const appId = callerApp(caller);
  // Development keys have no app row: an empty pack keeps local pickers working.
  if (!appId) return json(buildCustomPack([], imageOrigin(env, url)), 200, headers);

  const cacheKey = new Request(
    `${url.origin}/v1/custom-pack?${new URLSearchParams({
      app: appId,
      tenant: tenant ?? "",
      v: CUSTOM_PACK_CACHE_VERSION,
    })}`,
  );
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // An edge miss reads D1 directly and refreshes this isolate's search cache on the way.
  const set = await custom.load(appId, tenant);
  // Without the database, answer empty (never a hard failure) but do not cache that answer.
  if (!set.complete) return json(set.pack(imageOrigin(env, url)), 200, { "Cache-Control": "no-store" });
  const response = json(set.pack(imageOrigin(env, url)), 200, headers);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
