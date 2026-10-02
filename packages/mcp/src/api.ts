import { normalize, type SearchResult } from "emojisense";

/** The API truncates reaction text to 256 characters (docs/API.md); sending more is waste. */
const MAX_REACTION_TEXT = 256;
const SOURCES = new Set<SearchResult["source"]>(["alias", "semantic", "custom"]);

export interface ApiClientOptions {
  /** Base URL of the Emojisense API, e.g. "https://api.emojisense.com". */
  baseUrl: string;
  /** Secret key (`sk_live_…`). Sent as `Authorization: Bearer`; never as a query parameter. */
  secretKey: string;
  fetch?: typeof fetch;
  /** Give up on a request after this long and use the offline results. Default 4 s. */
  timeoutMs?: number;
  /** After an over-limit answer, skip the API for this long. Default 1 hour. */
  overLimitCooldownMs?: number;
  now?: () => number;
  /** Called when a request fails. The tool result does not change: it uses offline results. */
  onError?: (error: unknown) => void;
}

export interface ApiRequestOptions {
  locale?: string;
  limit?: number;
}

/**
 * The semantic layer of the hosted API. Every method resolves to `undefined` instead of
 * throwing: on a network error, a timeout, a non-2xx status or `overLimit: true`, the caller
 * keeps its offline results (docs/ARCHITECTURE.md, invariant 3).
 */
export interface EmojisenseApi {
  /** `GET /v1/search?mode=semantic`. For short queries only: the Worker logs normalized query text. */
  search(query: string, options?: ApiRequestOptions): Promise<SearchResult[] | undefined>;
  /** `POST /v1/suggest-reactions`. For message text: the API never logs or caches it. */
  suggestReactions(text: string, options?: ApiRequestOptions): Promise<SearchResult[] | undefined>;
}

export function createApiClient(options: ApiClientOptions): EmojisenseApi {
  const { secretKey, timeoutMs = 4000, overLimitCooldownMs = 3_600_000, onError } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const base = options.baseUrl.replace(/\/+$/, "");
  let pausedUntil = 0;

  async function request(path: string, json?: unknown): Promise<SearchResult[] | undefined> {
    if (now() < pausedUntil) return undefined;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await doFetch(`${base}${path}`, {
        method: json === undefined ? "GET" : "POST",
        headers,
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}`);
      const body = (await response.json()) as { results?: unknown; overLimit?: unknown };
      if (body.overLimit === true) {
        pausedUntil = now() + overLimitCooldownMs;
        return undefined;
      }
      return parseResults(body.results);
    } catch (error) {
      onError?.(error);
      return undefined;
    }
  }

  return {
    search(query, { locale = "en", limit = 24 } = {}) {
      const q = normalize(query);
      if (q === "") return Promise.resolve(undefined);
      const params = new URLSearchParams({ q, locale, limit: String(limit), mode: "semantic" });
      return request(`/v1/search?${params}`);
    },
    suggestReactions(text, { locale = "en", limit = 8 } = {}) {
      const trimmed = text.trim().slice(0, MAX_REACTION_TEXT);
      if (trimmed === "") return Promise.resolve(undefined);
      return request("/v1/suggest-reactions", { text: trimmed, locale, limit });
    },
  };
}

/** Keep only well-formed results: the response crosses a trust boundary. */
function parseResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) throw new Error("API response has no results array");
  return value.flatMap((item): SearchResult[] => {
    const { emoji, id, score, source } = (item ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || typeof score !== "number" || !Number.isFinite(score)) return [];
    return [
      {
        emoji: typeof emoji === "string" ? emoji : "",
        id,
        score,
        source: SOURCES.has(source as SearchResult["source"])
          ? (source as SearchResult["source"])
          : "semantic",
      },
    ];
  });
}

export interface ApiEnv {
  EMOJISENSE_API_URL?: string | undefined;
  EMOJISENSE_SECRET_KEY?: string | undefined;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The API client when both variables are set, else `undefined` (offline mode). A key is never
 * sent over plain HTTP, except to a local development server.
 */
export function apiFromEnv(
  env: ApiEnv,
  options: Omit<ApiClientOptions, "baseUrl" | "secretKey"> & { warn?: (message: string) => void } = {},
): EmojisenseApi | undefined {
  const { warn = () => {}, ...clientOptions } = options;
  const baseUrl = env.EMOJISENSE_API_URL?.trim();
  const secretKey = env.EMOJISENSE_SECRET_KEY?.trim();
  if (!baseUrl && !secretKey) return undefined;
  if (!baseUrl || !secretKey) {
    warn("set both EMOJISENSE_API_URL and EMOJISENSE_SECRET_KEY to enable semantic results; running offline");
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    warn(`EMOJISENSE_API_URL is not a valid URL; running offline`);
    return undefined;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    warn("EMOJISENSE_API_URL must use https (http is allowed for localhost only); running offline");
    return undefined;
  }
  return createApiClient({ ...clientOptions, baseUrl: url.origin + url.pathname, secretKey });
}
