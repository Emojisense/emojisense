import { embeddingText, normalize, type SearchResult } from "emojisense";
import { type Outcome, record } from "./analytics.ts";
import {
  BROWSER_CACHE,
  CULTURE_BROWSER_CACHE,
  EDGE_CACHE_SECONDS,
  MAX_LIMIT,
  SEARCH_DEFAULT_LIMIT,
} from "./config.ts";
import type { Handler } from "./context.ts";
import { type ApiCultureResult, applyServerCulture, parseCultureParams } from "./culture.ts";
import { CUSTOM_BROWSER_CACHE, imageOrigin, mergeCustom, parseTenant } from "./custom.ts";
import { errorResponse, json, parseLimit, parseLocale, unknownLocale } from "./http.ts";
import { indexTag, modelTag, rank } from "./semantic.ts";

/** Response of /v1/search and /v1/suggest-reactions (docs/API.md). */
export interface SearchBody {
  query: string;
  /** With `culture=1`, culture results (`source: "culture"`) carry `context` and `cultureId`. */
  results: (SearchResult | ApiCultureResult)[];
  packVersion: string;
  model: string;
  cached: boolean;
  /** Workers AI was unavailable; results are alias-only. */
  degraded: boolean;
  /** The key's account is over its monthly plan limit; no semantic results until the next period. */
  overLimit: boolean;
  /**
   * The locale whose aliases were fused into the results. null: no alias search ran (semantic
   * mode), or the locale's pack could not be loaded and the results are semantic-only.
   */
  aliasLocale: string | null;
  /**
   * Search only. The culture file applied with `culture=1`: its first day and the caller's
   * region. null when culture is off, or no culture file could be loaded for the locale.
   */
  culture?: { from: string; region: string | null } | null;
}

function parseParams(url: URL) {
  // The semantic tier embeds the text with its accents and punctuation; aliases, custom emoji
  // and analytics use its normalized form. Both come from one text, so it can key the cache.
  const text = embeddingText(url.searchParams.get("q") ?? "");
  return {
    query: normalize(text),
    embedText: text,
    locale: parseLocale(url.searchParams.get("locale")),
    limit: parseLimit(url.searchParams.get("limit"), SEARCH_DEFAULT_LIMIT, MAX_LIMIT),
    mode: url.searchParams.get("mode") === "semantic" ? ("semantic" as const) : ("hybrid" as const),
  };
}

/**
 * GET /v1/search. Metered as semantic_calls, Cache API hits included. Every answered search of a
 * key, cached and over-limit ones included, also goes to the app's analytics (query_daily). The
 * caller's custom emoji (with `tenant=`, the tenant's too) are matched per request and merged
 * first; they never enter the shared cache.
 */
export const handleSearch: Handler = async (
  request,
  env,
  ctx,
  { catalog, cache, custom },
  metering,
  caller,
) => {
  const started = Date.now();
  const url = new URL(request.url);
  const params = parseParams(url);
  if (!params.query) return errorResponse(400, "missing or empty q");
  const { locale } = params;
  if (!locale) return unknownLocale(url.searchParams.get("locale"));
  const tenant = parseTenant(url.searchParams.get("tenant"));
  if (tenant === "invalid") return errorResponse(400, "tenant must be at most 128 characters");
  const cultureParams = parseCultureParams(url);
  if (cultureParams instanceof Response) return cultureParams;
  // Culture is applied per request after the shared cache (never stored in it), like custom emoji.
  const cultureFile = cultureParams.enabled ? await catalog.culture?.(locale, env) : undefined;
  const withCulture = (results: SearchResult[]): SearchResult[] =>
    cultureFile
      ? applyServerCulture(results, cultureFile, params.query, {
          engine: catalog.engine(),
          locale,
          region: cultureParams.region,
          limit: params.limit,
          now: Date.now(),
        })
      : results;
  const culture = cultureFile ? { from: cultureFile.from, region: cultureParams.region ?? null } : null;
  const base = { query: params.query, packVersion: catalog.config.packVersion, model: modelTag(catalog) };
  const customSet = await custom.forCaller(caller, tenant);
  const customResults = customSet.search(imageOrigin(env, url), params.query, {
    limit: params.limit,
    prefix: true,
  });
  const withCustom = (results: SearchResult[]) => mergeCustom(customResults, results, params.limit);
  /** What the caller sees: culture on the canonical ranking, then their custom emoji first. */
  const present = (results: SearchResult[]) => withCustom(withCulture(results));
  const browserCache =
    customSet.rows.length > 0 ? CUSTOM_BROWSER_CACHE : cultureFile ? CULTURE_BROWSER_CACHE : BROWSER_CACHE;
  const log = (outcome: Outcome, scores: { aliasConfidence?: number; semanticTop?: number } = {}) =>
    record(env, indexTag(catalog), {
      endpoint: "search",
      query: params.query,
      locale,
      mode: params.mode,
      outcome,
      ms: Date.now() - started,
      ...scores,
    });

  const cacheKey = new Request(
    `${url.origin}/v1/search?${new URLSearchParams({
      q: params.embedText,
      locale,
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
    const body: SearchBody = {
      ...cached,
      results: present(cached.results),
      cached: true,
      degraded: false,
      overLimit: false,
      culture,
    };
    metering.recordSearch(params.query, body.results.length);
    return json(body, 200, {
      "Cache-Control": browserCache,
      "Server-Timing": `total;dur=${Date.now() - started}`,
    });
  }

  if (overLimit) {
    // Never a hard failure: hybrid callers still get the alias dictionary's answer.
    const ranked =
      params.mode === "hybrid"
        ? await rank(env, catalog, { aliasQuery: params.query, locale, limit: params.limit })
        : undefined;
    log("over_limit", { aliasConfidence: ranked?.aliasConfidence });
    const body: SearchBody = {
      ...base,
      results: present(ranked?.results ?? []),
      cached: false,
      degraded: false,
      overLimit: true,
      aliasLocale: ranked?.aliasLocale ?? null,
      culture,
    };
    metering.recordSearch(params.query, body.results.length);
    return json(body, 200, {
      "Cache-Control": "no-store",
      "Server-Timing": `total;dur=${Date.now() - started}`,
    });
  }

  const ranked = await rank(env, catalog, {
    aliasQuery: params.mode === "hybrid" ? params.query : undefined,
    embedText: params.embedText,
    locale,
    limit: params.limit,
  });
  const body: SearchBody = {
    ...base,
    results: ranked.results,
    cached: false,
    degraded: ranked.degraded,
    overLimit: false,
    aliasLocale: ranked.aliasLocale,
  };
  // Without the locale's aliases or vectors (a file did not load) the answer must not stay cached a week.
  const cacheable = !ranked.degraded && !ranked.aliasUnavailable && !ranked.vectorsUnavailable;
  if (ranked.semantic) metering.count("semantic_calls");
  if (ranked.semantic && cacheable) {
    const stored = json(body, 200, { "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }
  const answer: SearchBody = { ...body, results: present(body.results), culture };
  metering.recordSearch(params.query, answer.results.length);
  log(ranked.degraded ? "degraded" : "miss", {
    aliasConfidence: ranked.aliasConfidence,
    semanticTop: ranked.semanticTop,
  });
  return json(answer, 200, {
    // Degraded answers are not cached, so the client gets the full answer once AI is back.
    "Cache-Control": cacheable ? browserCache : "no-store",
    "Server-Timing": `embed;dur=${ranked.embedMs}, total;dur=${Date.now() - started}`,
  });
};
