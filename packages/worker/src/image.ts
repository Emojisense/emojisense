import type { AliasEngine, SearchResult } from "emojisense";
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
import { resolveEmoji } from "./emoji-lookup.ts";
import { errorResponse, json, parseLimit, parseLocale, readBodyCapped } from "./http.ts";
import { rankImage } from "./image-rank.ts";
import { indexTag, rank } from "./semantic.ts";
import { describeImage, type ImageLabel, sniffImage } from "./vision.ts";

export interface ClassifyImageBody {
  caption: string;
  reaction: string;
  /** Short search words the vision model gave for the image, most important first. */
  keywords: string[];
  results: SearchResult[];
  cached: boolean;
  /** Workers AI was unavailable: no caption, or no caption embedding (fewer results). */
  degraded: boolean;
  overLimit: boolean;
}

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/webp"]);
const IMAGE_HASH = /^[0-9a-f]{16}$/i;
/** Semantic neighbours of the caption that take part in the fusion. */
const CAPTION_NEIGHBOURS = 8;

/**
 * The cache key holds the model and the prompt version, so a new prompt never reads labels
 * written by an older one.
 */
export function labelCacheKey(origin: string, hash: string): Request {
  const params = new URLSearchParams({
    h: hash.toLowerCase(),
    v: `${VISION_MODEL}:${VISION_PROMPT_VERSION}`,
  });
  return new Request(`${origin}/v1/classify-image?${params}`);
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

async function cachedLabel(cache: CacheLike, key: Request): Promise<ImageLabel | undefined> {
  const hit = await cache.match(key);
  if (!hit) return undefined;
  try {
    const stored = (await hit.json()) as Partial<Record<keyof ImageLabel, unknown>>;
    if (typeof stored.caption !== "string" || !stored.caption) return undefined;
    return {
      caption: stored.caption,
      reaction: typeof stored.reaction === "string" ? stored.reaction : "",
      keywords: strings(stored.keywords),
      emoji: strings(stored.emoji),
    };
  } catch {
    return undefined;
  }
}

/** The catalog form of each emoji in a model's text; unknown ones are dropped. */
const catalogEmoji = (engine: AliasEngine) => (text: string) =>
  resolveEmoji(engine, text).map((id) => engine.get(id)?.emoji ?? "");

/**
 * POST /v1/classify-image (body: JPEG or WebP ≤ 256 KB; `?locale=&limit=`). A vision model
 * writes a caption, a likely reaction, keywords and the emoji it would pick. The ranking fuses
 * those emoji (checked against the catalog), an alias search per keyword and the semantic
 * neighbours of the caption (image-rank.ts). With `X-Image-Hash`, only the label is cached, keyed
 * by the perceptual hash and the prompt version. The image itself is never stored or logged.
 * Metered as image_classifications, cache hits included.
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
  const empty = { caption: "", reaction: "", keywords: [], results: [], cached: false };

  if (await metering.overLimit("image_classifications")) {
    return respond({ ...empty, degraded: false, overLimit: true }, "");
  }

  const engine = catalog.engine();
  const cacheKey = hash ? labelCacheKey(url.origin, hash) : undefined;
  let label = cacheKey ? await cachedLabel(cache, cacheKey) : undefined;
  const cached = label !== undefined;
  let visionMs = 0;
  if (!label) {
    const visionStarted = Date.now();
    try {
      label = await describeImage(env.AI, bytes, type, catalogEmoji(engine));
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

  const neighbours = await rank(env, catalog, {
    embedText: label.caption,
    locale,
    limit: CAPTION_NEIGHBOURS,
    privateText: true,
  });
  const results = rankImage(engine, label, neighbours.semantic ? neighbours.results : undefined, limit);
  const { caption, reaction, keywords } = label;
  return respond(
    { caption, reaction, keywords, results, cached, degraded: neighbours.degraded, overLimit: false },
    `vision;dur=${visionMs}, embed;dur=${neighbours.embedMs}, `,
  );
};
