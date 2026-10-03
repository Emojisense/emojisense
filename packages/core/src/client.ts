import { embeddingText, normalize } from "./normalize.js";
import {
  AUTO_REGION,
  isAutoRegion,
  type SemanticProvider,
  type SemanticResponse,
  type SemanticSearchOptions,
} from "./provider.js";

export interface SemanticClientOptions {
  /** Base URL of the Emojisense API, e.g. "https://api.emojisense.com". */
  endpoint: string;
  /** Publishable key (`pk_…`). Sent as a query parameter so no CORS preflight is needed. */
  key?: string;
  /** Pin a data pack version so results match the client's alias pack. */
  packVersion?: string;
  fetch?: typeof fetch;
  /** In-memory LRU of recent responses. Default 200 entries. */
  cacheSize?: number;
  /**
   * After an over-limit answer, skip the API for this long. Default 0: keep asking, because the
   * edge still answers queries that are in its shared cache. Over-limit misses are remembered.
   */
  overLimitCooldownMs?: number;
  /**
   * Abandon a request after this long; the session keeps its alias results. Default 5000 ms: a
   * long-tail query that needs the model takes up to about 1 s.
   */
  timeoutMs?: number;
  now?: () => number;
}

/** Aborts when `signal` does or after `ms`. `done` clears the timer. */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, ms);
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

/** The HTTP API as a semantic provider (layer "api"). */
export type SemanticClient = SemanticProvider;

/**
 * Over its plan limit the API still answers from its shared cache. For other queries it answers
 * `overLimit: true`, and search continues on the alias dictionary and shards. Never a hard failure.
 */
export function createSemanticClient(options: SemanticClientOptions): SemanticClient {
  const { endpoint, key, packVersion, cacheSize = 200, overLimitCooldownMs = 0, timeoutMs = 5000 } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const base = endpoint.replace(/\/+$/, "");
  const cache = new Map<string, SemanticResponse>();
  let pausedUntil = 0;

  /** The request URL, which is also the memory's key. Undefined: nothing to ask. */
  const urlFor = (query: string, { locale = "en", limit = 24, region }: SemanticSearchOptions) => {
    if (normalize(query) === "" || now() < pausedUntil) return undefined;
    // The text the Worker embeds, accents and punctuation kept (normalize() would fold them).
    const q = embeddingText(query);
    // The client fuses with its own alias results, so it asks for semantic results only.
    const params = new URLSearchParams({ q, locale, limit: String(limit), mode: "semantic" });
    // The session applies the culture layer on the device, after fusion; the API must not.
    params.set("culture", "0");
    // The API answers with the caller's region. A region code is never sent.
    if (isAutoRegion(region)) params.set("region", AUTO_REGION);
    if (packVersion) params.set("pack", packVersion);
    if (key) params.set("key", key);
    return `${base}/v1/search?${params}`;
  };

  /** From this client's memory: no request goes out, so it is not a fresh model answer. */
  const remembered = (url: string): SemanticResponse | undefined => {
    const hit = cache.get(url);
    if (!hit || hit.overLimit) return undefined;
    cache.delete(url);
    cache.set(url, hit);
    return { ...hit, cached: true };
  };

  return {
    peek(query, options = {}) {
      const url = urlFor(query, options);
      return url === undefined ? undefined : remembered(url);
    },
    async search(query, options = {}) {
      const url = urlFor(query, options);
      if (url === undefined) return undefined;
      if (cache.has(url)) return remembered(url);
      const request = withTimeout(options.signal, timeoutMs);
      let body: SemanticResponse;
      try {
        const response = await doFetch(url, { signal: request.signal });
        if (!response.ok) {
          throw new Error(`emojisense: semantic search failed with HTTP ${response.status}`);
        }
        body = { ...((await response.json()) as SemanticResponse), layer: "api" };
      } finally {
        request.done();
      }
      cache.set(url, body);
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
      if (body.overLimit) {
        pausedUntil = now() + overLimitCooldownMs;
        return undefined;
      }
      return body;
    },
  };
}
