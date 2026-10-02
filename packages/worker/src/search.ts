import { normalize, type SearchResult } from "emojisense";
import { type Outcome, record } from "./analytics.ts";
import { BROWSER_CACHE, EDGE_CACHE_SECONDS, MAX_LIMIT, SEARCH_DEFAULT_LIMIT } from "./config.ts";
import type { Handler } from "./context.ts";
import { errorResponse, json, parseLimit, parseLocale } from "./http.ts";
import { indexTag, modelTag, rank } from "./semantic.ts";

/** Response of /v1/search and /v1/suggest-reactions (docs/API.md). */
export interface SearchBody {
  query: string;
  results: SearchResult[];
  packVersion: string;
  model: string;
  cached: boolean;
  /** Workers AI was unavailable; results are alias-only. */
  degraded: boolean;
  /** The key is over its monthly limit; no semantic results until the next period. */
  overLimit: boolean;
}

function parseParams(url: URL) {
  return {
    query: normalize(url.searchParams.get("q") ?? ""),
    locale: parseLocale(url.searchParams.get("locale")),
    limit: parseLimit(url.searchParams.get("limit"), SEARCH_DEFAULT_LIMIT, MAX_LIMIT),
    mode: url.searchParams.get("mode") === "semantic" ? ("semantic" as const) : ("hybrid" as const),
  };
}

/** GET /v1/search. Metered as semantic_calls, Cache API hits included. */
export const handleSearch: Handler = async (request, env, ctx, { catalog, cache }, metering) => {
  const started = Date.now();
  const url = new URL(request.url);
  const params = parseParams(url);
  if (!params.query) return errorResponse(400, "missing or empty q");
  const base = { query: params.query, packVersion: catalog.config.packVersion, model: modelTag(catalog) };
  const log = (outcome: Outcome, scores: { aliasConfidence?: number; semanticTop?: number } = {}) =>
    record(env, indexTag(catalog), {
      endpoint: "search",
      query: params.query,
      locale: params.locale,
      mode: params.mode,
      outcome,
      ms: Date.now() - started,
      ...scores,
    });

  const cacheKey = new Request(
    `${url.origin}/v1/search?${new URLSearchParams({
      q: params.query,
      locale: params.locale,
      limit: String(params.limit),
      mode: params.mode,
      v: indexTag(catalog),
    })}`,
  );
  // The cache key has no key, user or origin in it: every app's searches warm the same edge cache,
  // so popular queries get faster and cheaper for everyone. Cached answers are served even over
  // the plan limit (they cost no model call), and those are not counted.
  const overLimit = await metering.overLimit("semantic_calls");
  const hit = await cache.match(cacheKey);
  if (hit) {
    const cached = (await hit.json()) as SearchBody;
    if (!overLimit) metering.count("semantic_calls");
    log(overLimit ? "hit_over_limit" : "hit");
    return json({ ...cached, cached: true, degraded: false, overLimit: false } satisfies SearchBody, 200, {
      "Cache-Control": BROWSER_CACHE,
      "Server-Timing": `total;dur=${Date.now() - started}`,
    });
  }

  if (overLimit) {
    // Never a hard failure: hybrid callers still get the alias dictionary's answer.
    const ranked =
      params.mode === "hybrid"
        ? await rank(env, catalog, { aliasQuery: params.query, locale: params.locale, limit: params.limit })
        : undefined;
    log("over_limit", { aliasConfidence: ranked?.aliasConfidence });
    const body: SearchBody = {
      ...base,
      results: ranked?.results ?? [],
      cached: false,
      degraded: false,
      overLimit: true,
    };
    return json(body, 200, {
      "Cache-Control": "no-store",
      "Server-Timing": `total;dur=${Date.now() - started}`,
    });
  }

  const ranked = await rank(env, catalog, {
    aliasQuery: params.mode === "hybrid" ? params.query : undefined,
    embedText: params.query,
    locale: params.locale,
    limit: params.limit,
  });
  const body: SearchBody = {
    ...base,
    results: ranked.results,
    cached: false,
    degraded: ranked.degraded,
    overLimit: false,
  };
  if (ranked.semantic) {
    metering.count("semantic_calls");
    const stored = json(body, 200, { "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }
  log(ranked.degraded ? "degraded" : "miss", {
    aliasConfidence: ranked.aliasConfidence,
    semanticTop: ranked.semanticTop,
  });
  return json(body, 200, {
    // Degraded answers are not cached, so the client gets semantic results once AI is back.
    "Cache-Control": ranked.degraded ? "no-store" : BROWSER_CACHE,
    "Server-Timing": `embed;dur=${ranked.embedMs}, total;dur=${Date.now() - started}`,
  });
};
