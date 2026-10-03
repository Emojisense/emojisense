import { embeddingText, normalize } from "./normalize.js";
import { AUTO_REGION, isAutoRegion, type SemanticProvider, type SemanticResponse } from "./provider.js";

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
  now?: () => number;
}

/** The HTTP API as a semantic provider (layer "api"). */
export type SemanticClient = SemanticProvider;

/**
 * Over its plan limit the API still answers from its shared cache. For other queries it answers
 * `overLimit: true`, and search continues on the alias dictionary and shards. Never a hard failure.
 */
export function createSemanticClient(options: SemanticClientOptions): SemanticClient {
  const { endpoint, key, packVersion, cacheSize = 200, overLimitCooldownMs = 0 } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const base = endpoint.replace(/\/+$/, "");
  const cache = new Map<string, SemanticResponse>();
  let pausedUntil = 0;

  return {
    async search(query, { locale = "en", limit = 24, signal, region } = {}) {
      if (normalize(query) === "" || now() < pausedUntil) return undefined;
      // The text the Worker embeds, accents and punctuation kept (normalize() would fold them).
      const q = embeddingText(query);

      // The client fuses with its own alias results, so it asks for semantic results only.
      const params = new URLSearchParams({ q, locale, limit: String(limit), mode: "semantic" });
      // The API answers with the caller's region. A region code is never sent.
      if (isAutoRegion(region)) params.set("region", AUTO_REGION);
      if (packVersion) params.set("pack", packVersion);
      if (key) params.set("key", key);
      const url = `${base}/v1/search?${params}`;

      const hit = cache.get(url);
      if (hit) {
        cache.delete(url);
        cache.set(url, hit);
        // From this client's memory: no request went out, so it is not a fresh model answer.
        return hit.overLimit ? undefined : { ...hit, cached: true };
      }
      const response = await doFetch(url, { signal: signal ?? null });
      if (!response.ok) {
        throw new Error(`emojisense: semantic search failed with HTTP ${response.status}`);
      }
      const body = { ...((await response.json()) as SemanticResponse), layer: "api" as const };
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
