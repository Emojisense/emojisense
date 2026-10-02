import type { SearchResult } from "./engine.js";
import { normalize } from "./normalize.js";

export interface SemanticResponse {
  results: SearchResult[];
  packVersion: string;
  model?: string;
  cached: boolean;
}

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
}

export interface SemanticSearchOptions {
  locale?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface SemanticClient {
  search(query: string, options?: SemanticSearchOptions): Promise<SemanticResponse>;
}

export function createSemanticClient(options: SemanticClientOptions): SemanticClient {
  const { endpoint, key, packVersion, cacheSize = 200 } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = endpoint.replace(/\/+$/, "");
  const cache = new Map<string, SemanticResponse>();

  return {
    async search(query, { locale = "en", limit = 24, signal } = {}) {
      const q = normalize(query);
      if (q === "") return { results: [], packVersion: packVersion ?? "", cached: true };

      const params = new URLSearchParams({ q, locale, limit: String(limit) });
      if (packVersion) params.set("pack", packVersion);
      if (key) params.set("key", key);
      const url = `${base}/v1/search?${params}`;

      const hit = cache.get(url);
      if (hit) {
        cache.delete(url);
        cache.set(url, hit);
        return hit;
      }
      const response = await doFetch(url, { signal: signal ?? null });
      if (!response.ok) {
        throw new Error(`emojisense: semantic search failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as SemanticResponse;
      cache.set(url, body);
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
      return body;
    },
  };
}
