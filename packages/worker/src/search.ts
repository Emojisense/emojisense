import { UNKNOWN_COUNTRY } from "@emojisense/platform";
import {
  assessConfidence,
  DEFAULT_SEMANTIC_CALIBRATION,
  embeddingText,
  normalize,
  type QueryConfidence,
  SEMANTIC_SURE,
  type SearchResult,
  type SemanticCalibration,
  semanticStrength,
} from "emojisense";
import { type Outcome, record } from "./analytics.ts";
import {
  BROWSER_CACHE,
  CULTURE_BROWSER_CACHE,
  EDGE_CACHE_SECONDS,
  MAX_LIMIT,
  REGION_AUTO_BROWSER_CACHE,
  SEARCH_DEFAULT_LIMIT,
} from "./config.ts";
import type { Handler } from "./context.ts";
import { type ApiCultureResult, applyServerCulture, parseCultureParams, utcDay } from "./culture.ts";
import { CUSTOM_BROWSER_CACHE, imageOrigin, mergeCustom, parseTenant } from "./custom.ts";
import type { Env } from "./env.ts";
import { errorResponse, json, parseLimit, parseLocale, unknownLocale } from "./http.ts";
import { edgeCountry } from "./region.ts";
import { type Catalog, indexTag, modelTag, type Ranked, rank } from "./semantic.ts";
import type { ServerTiming } from "./timing.ts";

/** Response of /v1/search and /v1/suggest-reactions (docs/API.md). */
export interface SearchBody {
  query: string;
  /** With `culture=1`, culture results (`source: "culture"`) carry `context` and `cultureId`. */
  results: (SearchResult | ApiCultureResult)[];
  packVersion: string;
  model: string;
  /**
   * Search only: the calibration of `model` (core's default is the production model's). Clients
   * fuse and judge semantic results with it (core session.ts).
   */
  calibration?: SemanticCalibration;
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
   * Search only. The culture file applied with `culture=1`: its first day, the UTC day its windows
   * were checked against, and the caller's region. null when culture is off, or no culture file
   * could be loaded for the locale.
   */
  culture?: { from: string; day: string; region: string | null } | null;
  /**
   * Search only, and only when the request has `region`: the region used for regional culture
   * entries. With `region=auto` it is the request's country (null when unknown), so an SDK can
   * apply regional entries on the device.
   */
  region?: string | null;
  /** Search only: 0–1, how well the tiers understood the query (`assessConfidence`). */
  confidence?: QueryConfidence["confidence"];
  /** Search only: no tier understood the query; show the results as guesses. */
  unsure?: QueryConfidence["unsure"];
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

type SearchParams = ReturnType<typeof parseParams>;

/**
 * The shared edge-cache entry of a search. It has no key, user or origin in it: every app's
 * searches warm the same edge cache, so popular queries get faster and cheaper for everyone. `c`
 * changes with the bundled data and engine, so a hotfix under the same pack version is not
 * answered from week-old entries.
 */
function cacheKeyOf(url: URL, params: SearchParams, locale: string, catalog: Catalog): Request {
  return new Request(
    `${url.origin}/v1/search?${new URLSearchParams({
      q: params.embedText,
      locale,
      limit: String(params.limit),
      mode: params.mode,
      v: indexTag(catalog),
      c: catalog.config.contentHash,
    })}`,
  );
}

/** The cache entry of a valid search request, else undefined (app.ts looks it up early). */
export function searchCacheKey(url: URL, catalog: Catalog): Request | undefined {
  const params = parseParams(url);
  return params.query && params.locale ? cacheKeyOf(url, params, params.locale, catalog) : undefined;
}

/**
 * How well the tiers understood the query. Semantic mode ran no alias search: the locale's
 * aliases are searched only when the semantic list is weak (a strong list is never unsure), so
 * most semantic calls load no locale pack.
 */
async function judgeQuery(
  env: Env,
  catalog: Catalog,
  ranked: Ranked,
  query: { text: string; locale: string; limit: number; mode: "hybrid" | "semantic" },
  timing: ServerTiming,
): Promise<QueryConfidence> {
  const semantic = ranked.semanticList;
  let alias = ranked.alias;
  const weak = semantic !== undefined && semanticStrength(semantic) < SEMANTIC_SURE;
  if (!alias && weak && query.mode === "semantic") {
    const engine = await timing.measure("locale", catalog.aliasEngine(query.locale, env));
    alias = engine?.search(query.text, { locale: query.locale, limit: query.limit });
  }
  return assessConfidence(alias, semantic);
}

/** Started now and awaited later: a failure meanwhile must not count as unhandled. */
function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

/**
 * GET /v1/search. Metered as semantic_calls, Cache API hits included. Every answered search of a
 * key, cached and over-limit ones included, also goes to the app's analytics (query_daily). The
 * caller's custom emoji (with `tenant=`, the tenant's too) are matched per request and merged
 * first; they never enter the shared cache. Anonymous callers never cause a model call: they get
 * shared-cache hits, else the answer of an account over its limit.
 *
 * Nothing waits for what it does not need. The edge-cache lookup starts before the key check
 * (app.ts); the culture file, the custom emoji and the account's usage are read at the same time.
 * A hit waits for the custom emoji and the culture file only. A miss starts the embedding at
 * once, while the usage is read.
 */
export const handleSearch: Handler = async (
  request,
  env,
  ctx,
  { catalog, cache, custom, timing },
  metering,
  caller,
) => {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const params = parseParams(url);
  if (!params.query) return errorResponse(400, "missing or empty q");
  const { locale } = params;
  if (!locale) return unknownLocale(url.searchParams.get("locale"));
  const tenant = parseTenant(url.searchParams.get("tenant"));
  if (tenant === "invalid") return errorResponse(400, "tenant must be at most 128 characters");
  // The edge country selects regional entries only with region=auto, and is an aggregate count
  // dimension of the app's analytics. It is never stored with a user and never keys the cache.
  const country = edgeCountry(request);
  const cultureParams = parseCultureParams(url, country === UNKNOWN_COUNTRY ? undefined : country);
  if (cultureParams instanceof Response) return cultureParams;

  // Culture and custom emoji are applied per request after the shared cache (never stored in it).
  const cultureLoad = started(
    cultureParams.enabled
      ? timing.measure("culture", catalog.culture?.(locale, env) ?? Promise.resolve(undefined))
      : Promise.resolve(undefined),
  );
  const customLoad = started(timing.measure("custom", custom.forCaller(caller, tenant)));
  // Cached answers are served even over the plan limit (they cost no model call), and those are
  // not counted. An anonymous caller has no model budget at all: it is treated as over the limit.
  const anonymous = caller.kind === "anonymous";
  const usage = anonymous ? { overLimit: true, fresh: true } : metering.peekOverLimit("semantic_calls");
  const knownOverLimit = usage?.fresh ? usage.overLimit : undefined;
  const overLimitLoad = started(
    knownOverLimit !== undefined
      ? Promise.resolve(knownOverLimit)
      : timing.measure("usage", metering.overLimit("semantic_calls")),
  );

  const regionEcho = cultureParams.regionRequested ? { region: cultureParams.region ?? null } : {};
  const searchRegion = { locale, country };
  const base = {
    query: params.query,
    packVersion: catalog.config.packVersion,
    model: modelTag(catalog),
    calibration: DEFAULT_SEMANTIC_CALIBRATION,
  };
  const log = (
    outcome: Outcome,
    scores: { aliasConfidence?: number; semanticTop?: number } = {},
    ms = Date.now() - startedAt,
  ) =>
    record(env, indexTag(catalog), {
      endpoint: "search",
      query: params.query,
      locale,
      mode: params.mode,
      outcome,
      ms,
      ...scores,
    });
  /** What the caller sees: culture on the canonical ranking, then their custom emoji first. */
  const presenter = async () => {
    const [customSet, cultureFile] = await Promise.all([customLoad, cultureLoad]);
    const customResults = customSet.search(imageOrigin(env, url), params.query, {
      limit: params.limit,
      prefix: true,
    });
    const withCulture = (results: SearchResult[]): SearchResult[] =>
      cultureFile
        ? applyServerCulture(results, cultureFile, params.query, {
            engine: catalog.engine(),
            locale,
            region: cultureParams.region,
            limit: params.limit,
            now: startedAt,
          })
        : results;
    return {
      present: (results: SearchResult[]) => mergeCustom(customResults, withCulture(results), params.limit),
      culture: cultureFile
        ? { from: cultureFile.from, day: utcDay(startedAt), region: cultureParams.region ?? null }
        : null,
      browserCache:
        customSet.rows.length > 0
          ? CUSTOM_BROWSER_CACHE
          : cultureParams.auto
            ? REGION_AUTO_BROWSER_CACHE
            : cultureFile
              ? CULTURE_BROWSER_CACHE
              : BROWSER_CACHE,
    };
  };
  const serverTiming = () => timing.header();

  const cacheKey = cacheKeyOf(url, params, locale, catalog);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const [cached, view] = await Promise.all([hit.json() as Promise<SearchBody>, presenter()]);
    const body: SearchBody = {
      ...cached,
      results: view.present(cached.results),
      cached: true,
      degraded: false,
      overLimit: false,
      culture: view.culture,
      ...regionEcho,
    };
    metering.recordSearch(params.query, body.results.length, searchRegion);
    const ms = Date.now() - startedAt;
    const countHit = (overLimit: boolean) => {
      if (!overLimit) metering.count("semantic_calls");
      log(overLimit && !anonymous ? "hit_over_limit" : "hit", {}, ms);
    };
    // The usage only decides whether a hit is counted: when it must be read, that happens after
    // the answer is sent.
    if (knownOverLimit !== undefined) countHit(knownOverLimit);
    else ctx.waitUntil(overLimitLoad.then(countHit));
    return json(body, 200, { "Cache-Control": view.browserCache, "Server-Timing": serverTiming() });
  }

  // A miss embeds the query at once, while the usage is read. An account this isolate last saw
  // over its limit waits for the read instead (usage only grows within a month). So an embedding
  // is dropped only when the first read of an account here finds it over the limit.
  const rankNow = () =>
    started(
      timing.measure(
        "rank",
        rank(env, catalog, {
          aliasQuery: params.mode === "hybrid" ? params.query : undefined,
          embedText: params.embedText,
          locale,
          limit: params.limit,
        }),
      ),
    );
  const ranking = usage?.overLimit === true ? undefined : rankNow();
  if (await overLimitLoad) {
    // Never a hard failure: hybrid callers still get the alias dictionary's answer.
    const ranked =
      params.mode === "hybrid"
        ? await rank(env, catalog, { aliasQuery: params.query, locale, limit: params.limit })
        : undefined;
    log(anonymous ? "anonymous" : "over_limit", { aliasConfidence: ranked?.aliasConfidence });
    // No model call: the dictionary's own verdict.
    const verdict = ranked?.alias ? assessConfidence(ranked.alias, undefined) : undefined;
    const view = await presenter();
    const body: SearchBody = {
      ...base,
      results: view.present(ranked?.results ?? []),
      cached: false,
      degraded: false,
      overLimit: true,
      aliasLocale: ranked?.aliasLocale ?? null,
      culture: view.culture,
      ...regionEcho,
      ...verdict,
    };
    metering.recordSearch(params.query, body.results.length, searchRegion);
    return json(body, 200, { "Cache-Control": "no-store", "Server-Timing": serverTiming() });
  }

  const ranked = await (ranking ?? rankNow());
  timing.add("embed", ranked.embedMs);
  timing.add("vectors", ranked.vectorsMs);
  if (ranked.alias !== undefined || ranked.aliasUnavailable) timing.add("locale", ranked.localeMs);
  // Hybrid mode searched the aliases already (its pack can be missing): no second load.
  const verdict = await judgeQuery(
    env,
    catalog,
    ranked,
    { text: params.query, locale, limit: params.limit, mode: params.mode },
    timing,
  );
  const body: SearchBody = {
    ...base,
    results: ranked.results,
    cached: false,
    degraded: ranked.degraded,
    overLimit: false,
    aliasLocale: ranked.aliasLocale,
    ...verdict,
  };
  // Without the locale's aliases or vectors (a file did not load), the answer must not stay
  // cached a week.
  const cacheable = !ranked.degraded && !ranked.aliasUnavailable && !ranked.vectorsUnavailable;
  if (ranked.semantic) metering.count("semantic_calls");
  if (ranked.semantic && cacheable) {
    const stored = json(body, 200, { "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }
  const view = await presenter();
  const answer: SearchBody = {
    ...body,
    results: view.present(body.results),
    culture: view.culture,
    ...regionEcho,
  };
  metering.recordSearch(params.query, answer.results.length, searchRegion);
  log(ranked.degraded ? "degraded" : "miss", {
    aliasConfidence: ranked.aliasConfidence,
    semanticTop: ranked.semanticTop,
  });
  return json(answer, 200, {
    // Degraded answers are not cached, so the client gets the full answer once AI is back.
    "Cache-Control": cacheable ? view.browserCache : "no-store",
    "Server-Timing": serverTiming(),
  });
};
