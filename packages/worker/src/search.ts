import type { EmbeddingModel } from "@emojisense/data/models";
import {
  type AliasEngine,
  fuse,
  l2normalize,
  normalize,
  type SearchResult,
  searchVectors,
  type VectorIndex,
} from "emojisense";
import type { Env, GeneratedConfig } from "./env.ts";

export interface Catalog {
  config: GeneratedConfig;
  model: EmbeddingModel;
  engine(): AliasEngine;
  index(): VectorIndex;
}

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface SearchBody {
  query: string;
  results: SearchResult[];
  packVersion: string;
  model: string;
  cached: boolean;
  /** Semantic tier unavailable; results are alias-only. */
  degraded?: boolean;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 24;
/** Tier 0 confidence below this marks a query as a "miss" worth mining for new aliases. */
const MISS_CONFIDENCE = 0.6;
const BROWSER_CACHE = "public, max-age=3600, s-maxage=86400";
const EDGE_CACHE_SECONDS = 7 * 24 * 3600;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...headers },
  });
}

function parseParams(url: URL) {
  const query = normalize(url.searchParams.get("q") ?? "");
  const locale = url.searchParams.get("locale") === "tr" ? "tr" : "en";
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;
  const mode = url.searchParams.get("mode") === "semantic" ? "semantic" : "hybrid";
  return { query, locale, limit, mode, key: url.searchParams.get("key") ?? "" } as const;
}

/** Returns an error response, or undefined when the caller may proceed. */
async function authorize(request: Request, env: Env, key: string): Promise<Response | undefined> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (key) {
    const valid = (env.PUBLISHABLE_KEYS ?? "").split(",").map((k) => k.trim());
    if (!valid.includes(key)) return json({ error: "invalid publishable key" }, 401);
  }
  // The IP is a rate-limit key only. It is never logged or stored.
  const limiter = key ? env.SEARCH_LIMITER : env.ANON_LIMITER;
  if (limiter && !(await limiter.limit({ key: `${key || "anon"}:${ip}` })).success) {
    return json({ error: "rate limited" }, 429, { "Retry-After": "60" });
  }
  return undefined;
}

async function embedQuery(env: Env, catalog: Catalog, query: string): Promise<Float32Array> {
  if (!env.AI) throw new Error("AI binding missing");
  const { config, model } = catalog;
  const text = config.queryTemplate.replace("{q}", query);
  const output = (await env.AI.run(config.modelId, model.input([text], "query"))) as {
    data?: number[][];
    response?: number[][];
  };
  const vector = (output.data ?? output.response)?.[0];
  if (!vector || vector.length < config.dims) throw new Error("unexpected embedding response");
  return l2normalize(Float32Array.from(vector.slice(0, config.dims)));
}

export async function handleSearch(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  catalog: Catalog,
  cache: CacheLike,
): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const params = parseParams(url);
  const denied = await authorize(request, env, params.key);
  if (denied) return denied;
  const { config } = catalog;
  const modelTag = `${config.modelKey}@${config.dims}`;
  if (!params.query) return json({ error: "missing or empty q" }, 400);

  const cacheKey = new Request(
    `${url.origin}/v1/search?${new URLSearchParams({
      q: params.query,
      locale: params.locale,
      limit: String(params.limit),
      mode: params.mode,
      v: `${config.packVersion}:${modelTag}`,
    })}`,
  );
  const hit = await cache.match(cacheKey);
  if (hit) {
    const body = (await hit.json()) as SearchBody;
    record(env, { ...params, cacheStatus: "hit", ms: Date.now() - started, modelTag, config });
    return json({ ...body, cached: true }, 200, {
      "Cache-Control": BROWSER_CACHE,
      "Server-Timing": `total;dur=${Date.now() - started}`,
    });
  }

  const alias =
    params.mode === "hybrid"
      ? catalog.engine().search(params.query, { locale: params.locale, limit: params.limit })
      : undefined;
  let semantic: SearchResult[] = [];
  let degraded = false;
  let embedMs = 0;
  try {
    const embedStarted = Date.now();
    const vector = await embedQuery(env, catalog, params.query);
    embedMs = Date.now() - embedStarted;
    const engine = catalog.engine();
    semantic = searchVectors(catalog.index(), vector, params.limit).map((m) => ({
      emoji: engine.get(m.id)?.emoji ?? "",
      id: m.id,
      score: Math.round(m.score * 1000) / 1000,
      source: "semantic" as const,
    }));
  } catch (error) {
    degraded = true;
    console.warn(JSON.stringify({ event: "semantic_unavailable", message: (error as Error).message }));
  }

  const results = alias ? fuse(alias, semantic, params.limit) : semantic;
  const body: SearchBody = {
    query: params.query,
    results: results.map(({ emoji, id, score, source }) => ({ emoji, id, score, source })),
    packVersion: config.packVersion,
    model: modelTag,
    cached: false,
    ...(degraded ? { degraded } : {}),
  };
  const response = json(body, 200, {
    "Cache-Control": degraded ? "no-store" : BROWSER_CACHE,
    "Server-Timing": `embed;dur=${embedMs}, total;dur=${Date.now() - started}`,
  });
  if (!degraded) {
    const stored = json(body, 200, { "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }
  record(env, {
    ...params,
    cacheStatus: degraded ? "degraded" : "miss",
    ms: Date.now() - started,
    modelTag,
    config,
    aliasConfidence: alias?.confidence,
    semanticTop: semantic[0]?.score,
  });
  return response;
}

interface Measurement {
  query: string;
  locale: string;
  mode: string;
  cacheStatus: "hit" | "miss" | "degraded";
  ms: number;
  modelTag: string;
  config: GeneratedConfig;
  aliasConfidence?: number | undefined;
  semanticTop?: number | undefined;
}

/**
 * One Analytics Engine point per search: counts, cache status, latency. The normalized query
 * text is kept only for misses (weak Tier 0 match) — the input for alias mining. No user id,
 * no IP, no key.
 */
function record(env: Env, m: Measurement) {
  const isMiss =
    m.cacheStatus !== "hit" && m.aliasConfidence !== undefined && m.aliasConfidence < MISS_CONFIDENCE;
  const point = {
    blobs: [isMiss ? m.query : "", m.locale, m.mode, m.cacheStatus, isMiss ? "miss" : "ok"],
    doubles: [m.ms, m.aliasConfidence ?? -1, m.semanticTop ?? -1],
    indexes: [`${m.config.packVersion}:${m.modelTag}`],
  };
  try {
    env.EVENTS?.writeDataPoint(point);
  } catch {
    // Analytics must never break search.
  }
}
