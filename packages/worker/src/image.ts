import type { SearchResult } from "emojisense";
import { record } from "./analytics.ts";
import {
  EDGE_CACHE_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_LIMIT,
  REACTIONS_DEFAULT_LIMIT,
  VISION_MODEL,
  VISION_PROMPT_VERSION,
} from "./config.ts";
import type { CacheLike, Handler } from "./context.ts";
import { errorResponse, json, parseLimit, parseLocale, readBodyCapped } from "./http.ts";
import { indexTag, rank } from "./semantic.ts";
import { describeImage, type ImageLabel, sniffImage } from "./vision.ts";

export interface ClassifyImageBody extends ImageLabel {
  results: SearchResult[];
  cached: boolean;
  /** Workers AI was unavailable: no caption, or alias-only results for the caption. */
  degraded: boolean;
  overLimit: boolean;
}

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/webp"]);
const IMAGE_HASH = /^[0-9a-f]{16}$/i;

async function cachedLabel(cache: CacheLike, key: Request): Promise<ImageLabel | undefined> {
  const hit = await cache.match(key);
  if (!hit) return undefined;
  try {
    const { caption, reaction } = (await hit.json()) as ImageLabel;
    return typeof caption === "string" && caption ? { caption, reaction: reaction ?? "" } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /v1/classify-image (body: JPEG or WebP ≤ 256 KB; `?locale=&limit=`). A vision model
 * writes a caption and a likely reaction, then `${caption}. ${reaction}` is searched like a
 * message. With `X-Image-Hash`, only the caption is cached, keyed by the perceptual hash. The
 * image itself is never stored or logged. Metered as image_classifications, cache hits included.
 */
export const handleClassifyImage: Handler = async (request, env, ctx, { catalog, cache }, metering) => {
  const started = Date.now();
  const url = new URL(request.url);
  const declaredType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(declaredType)) {
    return errorResponse(400, "Content-Type must be image/jpeg or image/webp");
  }
  const hash = request.headers.get("x-image-hash");
  if (hash !== null && !IMAGE_HASH.test(hash)) {
    return errorResponse(400, "X-Image-Hash must be 16 hex characters");
  }
  const bytes = await readBodyCapped(request, MAX_IMAGE_BYTES);
  if (!bytes) return errorResponse(413, `image larger than ${MAX_IMAGE_BYTES / 1024} KB`);
  const type = sniffImage(bytes);
  if (!type) return errorResponse(400, "unreadable image: not a JPEG or WebP file");
  const locale = parseLocale(url.searchParams.get("locale"));
  const limit = parseLimit(url.searchParams.get("limit"), REACTIONS_DEFAULT_LIMIT, MAX_LIMIT);

  const respond = (body: ClassifyImageBody, timing: string) => {
    record(env, indexTag(catalog), {
      endpoint: "image",
      locale,
      mode: "hybrid",
      outcome: body.overLimit ? "over_limit" : body.degraded ? "degraded" : body.cached ? "hit" : "miss",
      ms: Date.now() - started,
    });
    return json(body, 200, {
      "Cache-Control": "no-store",
      "Server-Timing": `${timing}total;dur=${Date.now() - started}`,
    });
  };
  const empty = { caption: "", reaction: "", results: [], cached: false };

  if (await metering.overLimit("image_classifications")) {
    return respond({ ...empty, degraded: false, overLimit: true }, "");
  }

  const cacheKey = hash
    ? new Request(
        `${url.origin}/v1/classify-image?${new URLSearchParams({
          h: hash.toLowerCase(),
          v: `${VISION_MODEL}:${VISION_PROMPT_VERSION}`,
        })}`,
      )
    : undefined;
  let label = cacheKey ? await cachedLabel(cache, cacheKey) : undefined;
  const cached = label !== undefined;
  let visionMs = 0;
  if (!label) {
    const visionStarted = Date.now();
    try {
      label = await describeImage(env.AI, bytes, type);
    } catch (error) {
      // No caption: report degraded, do not meter. The error name only; output may echo content.
      console.warn(JSON.stringify({ event: "vision_unavailable", error: (error as Error).name }));
      return respond({ ...empty, degraded: true, overLimit: false }, "");
    }
    visionMs = Date.now() - visionStarted;
    if (cacheKey) {
      const stored = json(label, 200, { "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}` });
      ctx.waitUntil(cache.put(cacheKey, stored));
    }
  }
  metering.count("image_classifications");

  const text = label.reaction ? `${label.caption}. ${label.reaction}` : label.caption;
  const ranked = await rank(env, catalog, {
    aliasQuery: text,
    embedText: text,
    locale,
    limit,
    prefix: false,
    privateText: true,
  });
  return respond(
    { ...label, results: ranked.results, cached, degraded: ranked.degraded, overLimit: false },
    `vision;dur=${visionMs}, embed;dur=${ranked.embedMs}, `,
  );
};
