import { normalize } from "./normalize.js";
import type { SemanticProvider, SemanticResponse } from "./provider.js";

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
  /** After an over-limit answer, skip the API for this long. Default 1 hour. */
  overLimitCooldownMs?: number;
  now?: () => number;
}

/** The HTTP API as a semantic provider (layer "api"). */
export type SemanticClient = SemanticProvider;

/**
 * Over its plan limit the API answers `overLimit: true`; the client then goes quiet for a while
 * and search continues on the alias dictionary and shards. Never a hard failure.
 */
export function createSemanticClient(options: SemanticClientOptions): SemanticClient {
  const { endpoint, key, packVersion, cacheSize = 200, overLimitCooldownMs = 3_600_000 } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const base = endpoint.replace(/\/+$/, "");
  const cache = new Map<string, SemanticResponse>();
  let pausedUntil = 0;

  return {
    async search(query, { locale = "en", limit = 24, signal } = {}) {
      const q = normalize(query);
      if (q === "" || now() < pausedUntil) return undefined;

      // The client fuses with its own alias results, so it asks for semantic results only.
      const params = new URLSearchParams({ q, locale, limit: String(limit), mode: "semantic" });
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
      const body = { ...((await response.json()) as SemanticResponse), layer: "api" as const };
      if (body.overLimit) {
        pausedUntil = now() + overLimitCooldownMs;
        return undefined;
      }
      cache.set(url, body);
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
      return body;
    },
  };
}
