import type { HostedEmojiSet, PackRow } from "emojisense";
import type { CacheLike } from "../context.ts";
import { corsHeaders, json, readBodyCapped } from "../http.ts";
import type { WaitUntil } from "../meter.ts";
import { createSetCatalog, parseHexcode, type SetCatalog, type SetEmoji } from "./catalog.ts";
import generated from "./upstreams.json";
import {
  createUpstreamResolver,
  isHostedSet,
  UPSTREAMS,
  type UpstreamData,
  upstreamUrl,
} from "./upstreams.ts";

export const SETS_PATH_PREFIX = "/v1/sets/";

/** A pinned upstream file never changes, so browsers and the edge keep it for a year. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
/** Unknown or undrawn emoji: the answer changes only with a deploy. */
const NOT_FOUND_CACHE = "public, max-age=86400";
/** The largest pinned file is a 760 KB Noto flag. */
export const MAX_SET_SVG_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
/** An SVG opened directly (not through `<img>`) must not run scripts on the API origin. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
const PATH = /^\/v1\/sets\/([^/]+)\/([^/]+)$/;

export interface EmojiSetsOptions {
  /** The pack rows that define the known emoji (every locale pack has the same rows). */
  rows: () => readonly PackRow[];
  fetch?: typeof fetch;
  /** Default: the generated src/sets/upstreams.json. */
  data?: UpstreamData;
}

export type EmojiSetsRoute = (
  request: Request,
  url: URL,
  ctx: WaitUntil,
  cache: CacheLike,
) => Promise<Response>;

/**
 * GET /v1/sets/:set/:hexcode.svg. Only emoji of the pack (and their single-tone variants) map to
 * a file, and only to a file of the pinned upstream commit, so the route never fetches a URL a
 * caller chose. Each file is fetched once per edge location and kept in the Cache API.
 * Public: no key, not metered, not rate limited (a picker loads hundreds of images).
 */
export function createEmojiSetsRoute(options: EmojiSetsOptions): EmojiSetsRoute {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const resolve = createUpstreamResolver(options.data ?? (generated as UpstreamData));
  let catalog: SetCatalog | undefined;

  return async (request, url, ctx, cache) => {
    if (request.method !== "GET") {
      return error(405, "method_not_allowed", "Use GET.", "no-store", { Allow: "GET, OPTIONS" });
    }
    const [, set = "", file = ""] = PATH.exec(url.pathname) ?? [];
    if (!set) return error(404, "not_found", "Use /v1/sets/<set>/<hexcode>.svg.");
    if (!isHostedSet(set)) {
      return error(404, "unknown_set", `Sets: ${Object.keys(UPSTREAMS).join(", ")}.`, NOT_FOUND_CACHE);
    }
    const hexcode = file.endsWith(".svg") ? file.slice(0, -".svg".length) : "";
    if (!parseHexcode(hexcode)) {
      return error(
        400,
        "invalid_hexcode",
        "Use an Emojibase hexcode, e.g. /v1/sets/twemoji/1F44D-1F3FD.svg.",
      );
    }
    catalog ??= createSetCatalog(options.rows());
    const entry = catalog.find(hexcode);
    if (!entry)
      return error(404, "unknown_emoji", `${hexcode} is not an emoji of the pack.`, NOT_FOUND_CACHE);
    const path = resolve(set, entry);
    if (!path) return error(404, "not_in_set", `${set} has no image for ${entry.hexcode}.`, NOT_FOUND_CACHE);

    // Keyed by the canonical hexcode and the pin: every spelling shares one entry, and a new
    // pin starts a new one.
    const cacheKey = new Request(
      `${url.origin}${SETS_PATH_PREFIX}${set}/${entry.hexcode}.svg?pin=${UPSTREAMS[set].commit.slice(0, 12)}`,
    );
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const svg = await fetchSvg(doFetch, set, path, entry);
    if (svg instanceof Response) return svg;
    const response = new Response(svg, { headers: svgHeaders(set) });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  };
}

async function fetchSvg(
  doFetch: typeof fetch,
  set: HostedEmojiSet,
  path: string,
  entry: SetEmoji,
): Promise<Uint8Array | Response> {
  const fail = (reason: string, status?: number) => {
    console.warn(
      JSON.stringify({ event: "set_upstream_failed", set, hexcode: entry.hexcode, reason, status }),
    );
    // The pinned commit cannot lose a file, so a 404 means upstreams.json is wrong: not cached.
    return status === 404
      ? error(404, "not_in_set", `${set} has no image for ${entry.hexcode}.`)
      : error(502, "upstream_unavailable", "The emoji image could not be loaded. Retry later.");
  };
  let response: Response;
  try {
    response = await doFetch(upstreamUrl(set, path), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (cause) {
    return fail((cause as Error).name);
  }
  if (!response.ok) return fail("status", response.status);
  if (!response.headers.get("content-type")?.startsWith("image/svg+xml")) return fail("content_type");
  const body = await readBodyCapped(response, MAX_SET_SVG_BYTES);
  return body ?? fail("too_large");
}

function svgHeaders(set: HostedEmojiSet): Record<string, string> {
  return {
    ...corsHeaders,
    "Content-Type": "image/svg+xml",
    "Cache-Control": IMMUTABLE,
    "Content-Security-Policy": SVG_CSP,
    "X-Content-Type-Options": "nosniff",
    // Attribution travels with each image; the full texts are in NOTICE.
    Link: `<${UPSTREAMS[set].license.url}>; rel="license"`,
  };
}

function error(
  status: number,
  code: string,
  message: string,
  cacheControl = "no-store",
  headers: Record<string, string> = {},
): Response {
  return json({ error: code, message }, status, { "Cache-Control": cacheControl, ...headers });
}
