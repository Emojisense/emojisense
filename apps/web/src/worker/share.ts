/**
 * Shared playground searches. `/s/?q=…&locale=…` is the playground page with share tags for that
 * query; its image, `/og/q/<version>/<locale>/<query>.png`, is a card of the query and its top
 * emoji. Everything else on the site stays static and never runs this Worker.
 *
 * Cost control, in order: a WAF rate rule in front of both paths (RELEASING.md), one canonical
 * URL per query, the Cache API, then rate limits on renders only. A request that is refused gets
 * the playground's static card, never an error.
 */
import { isLocale, LOCALE_INFO, type Locale } from "../i18n/locales";
import type { Env } from "./env";
import { workerCardRenderer } from "./renderer";

/** Bump when the query card draws differently: cached images then miss. */
export const QUERY_CARD_VERSION = "1";
const MAX_QUERY_CHARS = 64;
const MAX_RESULTS = 5;
const IMAGE_PREFIX = "/og/q/";
const CARD_CACHE = "public, max-age=604800";
const SHARE_PAGE_CACHE = "public, max-age=300";

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

/** Whitespace collapsed, NFC, at most 64 characters (the API cuts there too). */
export function normalizeQuery(raw: string | null): string {
  const text = (raw ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
  return Array.from(text).slice(0, MAX_QUERY_CHARS).join("").trim();
}

export function queryCardPath(query: string, locale: Locale): string {
  return `${IMAGE_PREFIX}${QUERY_CARD_VERSION}/${locale}/${encodeURIComponent(query)}.png`;
}

function shareUrl(origin: string, query: string, locale: Locale): string {
  const params = new URLSearchParams({ q: query });
  if (locale !== "en") params.set("locale", locale);
  return `${origin}/s/?${params}`;
}

const isRtl = (text: string) => /[\p{sc=Arabic}\p{sc=Hebrew}]/u.test(text);

export async function handleSharePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("q"));
  const localeParam = url.searchParams.get("locale");
  const locale: Locale = isLocale(localeParam) ? localeParam : "en";
  if (!query) return Response.redirect(`${url.origin}/playground/${url.search}`, 302);

  const page = await env.ASSETS.fetch(new Request(`${url.origin}/playground/`, { headers: request.headers }));
  if (!page.ok) return page;

  const quoted = isRtl(query) ? query : `“${query}”`;
  const title = `${quoted} · Emoji search · Emojisense`;
  const description = `The emoji Emojisense finds for ${quoted} in ${LOCALE_INFO[locale].name}. Search emoji the way people talk, in 11 languages.`;
  const image = `${url.origin}${queryCardPath(query, locale)}`;
  const content = (value: string) => ({
    element(element: Element) {
      element.setAttribute("content", value);
    },
  });
  const rewritten = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', content(description))
    .on('meta[property="og:title"]', content(title))
    .on('meta[name="twitter:title"]', content(title))
    .on('meta[property="og:description"]', content(description))
    .on('meta[name="twitter:description"]', content(description))
    .on('meta[property="og:url"]', content(shareUrl(url.origin, query, locale)))
    .on('meta[property="og:image"]', content(image))
    .on('meta[name="twitter:image"]', content(image))
    .on('meta[property="og:image:alt"]', content(`Emoji search for ${quoted}`))
    .on('meta[name="twitter:image:alt"]', content(`Emoji search for ${quoted}`))
    // Any query makes a page: none of them belongs in a search index (the canonical stays /playground/).
    .on("head", {
      element(element) {
        element.append('<meta name="robots" content="noindex">', { html: true });
      },
    })
    .transform(page);
  const headers = new Headers(rewritten.headers);
  headers.set("Cache-Control", SHARE_PAGE_CACHE);
  headers.set("X-Robots-Tag", "noindex");
  return new Response(rewritten.body, { status: 200, headers });
}

let staticCard: string | undefined;

/** The playground's static card: the answer whenever a query card is not drawn. */
async function fallback(env: Env, origin: string): Promise<Response> {
  if (!staticCard) {
    const html = await (await env.ASSETS.fetch(new Request(`${origin}/playground/`))).text();
    staticCard = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  }
  return new Response(null, {
    status: 302,
    headers: { Location: staticCard ?? `${origin}/playground/`, "Cache-Control": "no-store" },
  });
}

function parseImagePath(pathname: string): { version: string; locale: string; raw: string } | undefined {
  const match = /^\/og\/q\/([^/]+)\/([^/]+)\/([^/]+)\.png$/.exec(pathname);
  if (!match) return undefined;
  const [, version = "", locale = "", raw = ""] = match;
  return { version, locale, raw };
}

async function topEmoji(env: Env, request: Request, query: string, locale: Locale): Promise<string[]> {
  const params = new URLSearchParams({ q: query, locale, limit: String(MAX_RESULTS) });
  // No key: the API answers from aliases without a model call, and rate-limits per visitor IP.
  const headers = new Headers({ Accept: "application/json" });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("CF-Connecting-IP", ip);
  const response = await env.API.fetch(new Request(`https://api.internal/v1/search?${params}`, { headers }));
  if (!response.ok) return [];
  const body = (await response.json()) as { results?: { emoji?: unknown }[] };
  return (body.results ?? [])
    .map((result) => result.emoji)
    .filter((emoji): emoji is string => typeof emoji === "string")
    .slice(0, MAX_RESULTS);
}

export async function handleQueryCard(request: Request, env: Env, ctx: Context): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseImagePath(url.pathname);
  if (!parsed || parsed.version !== QUERY_CARD_VERSION || !isLocale(parsed.locale))
    return fallback(env, url.origin);
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.raw);
  } catch {
    return fallback(env, url.origin);
  }
  const query = normalizeQuery(decoded);
  if (!query) return fallback(env, url.origin);
  const canonical = `${url.origin}${queryCardPath(query, parsed.locale)}`;
  if (canonical !== `${url.origin}${url.pathname}` || url.search) return Response.redirect(canonical, 301);

  const cache = caches.default;
  const hit = await cache.match(canonical);
  if (hit) return hit;

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const [perIp, perLocation] = await Promise.all([
    env.OG_IP_LIMITER.limit({ key: ip }),
    env.OG_LOCATION_LIMITER.limit({ key: "all" }),
  ]);
  if (!perIp.success || !perLocation.success) return fallback(env, url.origin);

  try {
    const results = await topEmoji(env, request, query, parsed.locale);
    if (results.length === 0) return fallback(env, url.origin);
    const renderer = await workerCardRenderer();
    const info = LOCALE_INFO[parsed.locale];
    const png = await renderer.png({
      kind: "query",
      query,
      queryLang: { tag: info.tag, dir: isRtl(query) ? "rtl" : "ltr" },
      languageName: info.name,
      results,
      url: `${url.host}/playground`,
    });
    const response = new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": CARD_CACHE },
    });
    ctx.waitUntil(cache.put(canonical, response.clone()));
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "query_card_failed", error: (error as Error).name }));
    return fallback(env, url.origin);
  }
}
