import type { SearchResult } from "./engine.js";
import { normalize } from "./normalize.js";
import type { SemanticProvider, SemanticResponse } from "./provider.js";

/** `<base>/index.json`: which prefix keys exist (adaptive: hot prefixes get longer keys). */
export interface ShardIndex {
  format: "emojisense-shards";
  formatVersion: 1;
  packVersion: string;
  /** e.g. "embeddinggemma@256" — results are valid only for this model. */
  model: string;
  /** Sorted shard keys; a query uses the longest key that is a prefix of it. */
  keys: string[];
}

/** `<base>/<key>.json`: precomputed semantic results for frequent normalized queries. */
export interface Shard {
  key: string;
  /** normalized query → [emoji, hexcode, score][] */
  entries: Record<string, [string, string, number][]>;
}

export interface ShardProviderOptions {
  /** e.g. "https://api.emojisense.com/p/0.1.0" */
  baseUrl: string;
  fetch?: typeof fetch;
}

/** Longest key that is a prefix of the query (keys are few; a linear scan is fine). */
export function shardKeyFor(keys: readonly string[], query: string): string | undefined {
  let best: string | undefined;
  for (const key of keys) {
    if (query.startsWith(key) && (best === undefined || key.length > best.length)) best = key;
  }
  return best;
}

/**
 * Layer 2: precomputed results served as static files. One download per prefix, then every
 * further keystroke with that prefix is answered locally. Unknown queries return `undefined`
 * so the next provider (the API) is asked.
 */
export function createShardProvider(options: ShardProviderOptions): SemanticProvider {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let index: Promise<ShardIndex | undefined> | undefined;
  const shards = new Map<string, Promise<Shard | undefined>>();

  const getJson = async <T>(url: string): Promise<T | undefined> => {
    try {
      const response = await doFetch(url);
      return response.ok ? ((await response.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async search(query, { limit = 24 } = {}) {
      const q = normalize(query);
      if (q === "") return undefined;
      index ??= getJson<ShardIndex>(`${base}/index.json`);
      const loaded = await index;
      const key = loaded && shardKeyFor(loaded.keys, q);
      if (!loaded || key === undefined) return undefined;

      let shard = shards.get(key);
      if (!shard) {
        shard = getJson<Shard>(`${base}/${encodeURIComponent(key)}.json`);
        shards.set(key, shard);
      }
      const entry = (await shard)?.entries[q];
      if (!entry) return undefined;
      const results: SearchResult[] = entry.slice(0, limit).map(([emoji, id, score]) => ({
        emoji,
        id,
        score,
        source: "semantic",
      }));
      const response: SemanticResponse = {
        results,
        packVersion: loaded.packVersion,
        model: loaded.model,
        cached: true,
        layer: "shard",
      };
      return response;
    },
  };
}
