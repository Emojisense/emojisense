import type { SearchResult } from "./engine.js";
import { embeddingText, normalize } from "./normalize.js";
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
  /**
   * e.g. "https://api.emojisense.com/p/0.1.0". English shards are at this URL; the shards of
   * another pack locale are in its directory, e.g. "…/p/0.1.0/tr" (PACK_FORMAT.md §6).
   */
  baseUrl: string;
  fetch?: typeof fetch;
}

/**
 * The shard directory of a locale: the base URL for English (and no locale), as before locale
 * shards existed, else `<base>/<locale>`.
 */
export function shardBaseFor(baseUrl: string, locale: string | undefined): string {
  const base = baseUrl.replace(/\/+$/, "");
  const code = (locale ?? "").toLowerCase();
  return code === "" || code === "en" ? base : `${base}/${encodeURIComponent(code)}`;
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
 *
 * Each search reads the shards of its locale (the API's answers for that locale: the shared
 * vectors and the locale's own). A locale without shards (its index answers 404) goes to the API.
 *
 * Shards hold the answers for normalized text. A query typed with accents, punctuation or emoji
 * ("doğum günü", "i'm done!") also returns `undefined`: the API embeds it as typed, and the folded
 * text's answer would differ (PACK_FORMAT.md §6).
 */
export function createShardProvider(options: ShardProviderOptions): SemanticProvider {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  /** Shard directory → its index and the shards loaded from it. */
  const directories = new Map<
    string,
    { index: Promise<ShardIndex | undefined>; shards: Map<string, Promise<Shard | undefined>> }
  >();

  const getJson = async <T>(url: string): Promise<T | undefined> => {
    try {
      const response = await doFetch(url);
      return response.ok ? ((await response.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async search(query, { limit = 24, locale } = {}) {
      const q = normalize(query);
      if (q === "" || embeddingText(query) !== q) return undefined;
      const base = shardBaseFor(options.baseUrl, locale);
      let directory = directories.get(base);
      if (!directory) {
        directory = { index: getJson<ShardIndex>(`${base}/index.json`), shards: new Map() };
        directories.set(base, directory);
      }
      const { shards } = directory;
      const loaded = await directory.index;
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
