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
  /**
   * Key → URL of its file, relative to this index. The files are named by their content, so they
   * never change and are cached for good. Absent (older builds): `<key>.json` next to the index.
   */
  files?: Record<string, string>;
  /**
   * URL of the base layer's index for the same locale, relative to this index: synthetic queries
   * built with the pack, asked after this layer (PACK_FORMAT.md §6).
   */
  base?: string;
}

/** `<base>/<key>.json`: precomputed semantic results for frequent normalized queries. */
export interface Shard {
  key: string;
  /** normalized query → [emoji, hexcode, score][] */
  entries: Record<string, [string, string, number][]>;
}

export interface ShardProviderOptions {
  /**
   * e.g. "https://cdn.emojisense.com/p/0.1.0". English shards are at this URL; the shards of
   * another pack locale are in its directory, e.g. "…/p/0.1.0/tr" (PACK_FORMAT.md §6).
   */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Abandon a file request after this long. Default 5000 ms. */
  timeoutMs?: number;
  /** After a network error or a timeout, ask for that file again after this long. Default 10 s. */
  retryMs?: number;
}

/**
 * The shard directory of a locale: the base URL for English (and no locale), as before locale
 * shards existed, else `<base>/<language>`. Like the API's `locale`, only the language subtag
 * counts ("pt-BR" → "pt").
 */
export function shardBaseFor(baseUrl: string, locale: string | undefined): string {
  const base = baseUrl.replace(/\/+$/, "");
  const language = (locale ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return language === "" || language === "en" ? base : `${base}/${encodeURIComponent(language)}`;
}

/** Longest key that is a prefix of the query (keys are few; a linear scan is fine). */
export function shardKeyFor(keys: readonly string[], query: string): string | undefined {
  let best: string | undefined;
  for (const key of keys) {
    if (query.startsWith(key) && (best === undefined || key.length > best.length)) best = key;
  }
  return best;
}

/** A file being loaded. `value` is set once it arrived, so `peek` can read it without waiting. */
interface Loading<T> {
  promise: Promise<T | undefined>;
  value?: T;
}

/**
 * Layer 2: precomputed results served as static files. One download per prefix, then every
 * further keystroke with that prefix is answered locally (`peek`, no debounce). Unknown queries
 * return `undefined` so the next provider (the API) is asked.
 *
 * Each locale has a live layer (`index.json`, real queries, rebuilt nightly) and, when its index
 * names one, a base layer (synthetic queries, built with the pack). Both hold the API's answers
 * for that locale, so the order only decides which file is read first.
 *
 * Shards hold the answers for normalized text. A query typed with accents, punctuation or emoji
 * ("doğum günü", "i'm done!") also returns `undefined`: the API embeds it as typed, and the folded
 * text's answer would differ (PACK_FORMAT.md §6).
 */
export function createShardProvider(options: ShardProviderOptions): SemanticProvider {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryMs = options.retryMs ?? 10_000;
  /**
   * A 404 stays remembered (the file does not exist); a network error or a timeout is forgotten
   * after `retryMs`, so a later keystroke asks again, but an unreachable host is not asked on
   * every keystroke.
   */
  const load = <T>(url: string, memo: Map<string, Loading<T>>): Loading<T> => {
    const known = memo.get(url);
    if (known) return known;
    const loading = {} as Loading<T>;
    memo.set(url, loading);
    loading.promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(url, { signal: controller.signal });
        if (!response.ok) return undefined;
        const value = (await response.json()) as T;
        loading.value = value;
        return value;
      } catch {
        setTimeout(() => memo.delete(url), retryMs);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    })();
    return loading;
  };

  const indexes = new Map<string, Loading<ShardIndex>>();
  const files = new Map<string, Loading<Shard>>();
  const resolve = (path: string, from: string) => new URL(path, from).href;
  const liveUrl = (locale: string | undefined) => `${shardBaseFor(options.baseUrl, locale)}/index.json`;

  /** A file that is not a shard index (e.g. an error page served as 200) counts as none. */
  const valid = (index: ShardIndex | undefined) => (Array.isArray(index?.keys) ? index : undefined);

  /** The layers of a locale as [index URL, index]: the live index, then the base it names. */
  const layers = (live: ShardIndex | undefined, url: string, base: ShardIndex | undefined) =>
    (valid(live)
      ? [[url, live], ...(valid(base) ? [[resolve(live?.base as string, url), base]] : [])]
      : []) as [string, ShardIndex][];

  /** Both indexes, loaded if needed. */
  const loadLayers = async (locale: string | undefined) => {
    const url = liveUrl(locale);
    const live = await load(url, indexes).promise;
    const base = live?.base ? await load(resolve(live.base, url), indexes).promise : undefined;
    return layers(live, url, base);
  };

  /** The indexes already in memory, for `peek`. */
  const loadedLayers = (locale: string | undefined) => {
    const url = liveUrl(locale);
    const live = indexes.get(url)?.value;
    return layers(live, url, live?.base ? indexes.get(resolve(live.base, url))?.value : undefined);
  };

  /** URL of the query's shard in a layer; undefined when no key matches. */
  const fileOf = ([url, index]: [string, ShardIndex], q: string) => {
    const key = shardKeyFor(index.keys, q);
    return key === undefined
      ? undefined
      : resolve(index.files?.[key] ?? `${encodeURIComponent(key)}.json`, url);
  };

  /** The text shards hold for this query, or undefined when shards cannot answer it. */
  const shardText = (query: string) => {
    const q = normalize(query);
    return q === "" || embeddingText(query) !== q ? undefined : q;
  };

  const answer = (index: ShardIndex, entry: [string, string, number][], limit: number): SemanticResponse => ({
    results: entry
      .slice(0, limit)
      .map(([emoji, id, score]): SearchResult => ({ emoji, id, score, source: "semantic" })),
    packVersion: index.packVersion,
    model: index.model,
    cached: true,
    layer: "shard",
  });

  return {
    async search(query, { limit = 24, locale } = {}) {
      const q = shardText(query);
      if (q === undefined) return undefined;
      const found = await loadLayers(locale);
      // Both shards load at once: a miss in the live layer does not wait for a second round trip.
      const shards = found.map((layer) => {
        const url = fileOf(layer, q);
        return url === undefined ? undefined : load(url, files).promise;
      });
      for (const [i, [, index]] of found.entries()) {
        const entry = (await shards[i])?.entries[q];
        if (entry) return answer(index, entry, limit);
      }
      return undefined;
    },

    peek(query, { limit = 24, locale } = {}) {
      const q = shardText(query);
      if (q === undefined) return undefined;
      for (const layer of loadedLayers(locale)) {
        const url = fileOf(layer, q);
        const entry = url === undefined ? undefined : files.get(url)?.value?.entries[q];
        if (entry) return answer(layer[1], entry, limit);
      }
      return undefined;
    },

    prefetch(query, { locale } = {}) {
      const q = query === "" ? undefined : shardText(query);
      void loadLayers(locale).then((found) => {
        for (const layer of found) {
          const url = q === undefined ? undefined : fileOf(layer, q);
          if (url !== undefined) load(url, files);
        }
      });
    },
  };
}
