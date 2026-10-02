import {
  type AliasEngine,
  createSearchSession,
  normalize,
  type SemanticProvider,
  type SessionState,
} from "emojisense";
import { createEmojiMartIndex, type EmojiMartData, type EmojiMartEmoji, toEmojiMart } from "./map.js";

export interface EmojiMartSearchOptions {
  /** The `@emoji-mart/data` object your picker uses. */
  data: EmojiMartData;
  engine: AliasEngine;
  /** Semantic layers, e.g. `createLayeredSemantic({ shardsUrl, endpoint })`. Omit for on-device only. */
  semantic?: SemanticProvider;
  locale?: string;
  /** Default 90, emoji-mart's own `maxResults`. */
  limit?: number;
  debounceMs?: number;
  /** Ranked emoji-mart emoji: alias results at once, fused results after the debounce. */
  onResults: (emojis: EmojiMartEmoji[], state: SessionState) => void;
}

export interface EmojiMartSearch {
  update(query: string): void;
  dispose(): void;
}

const EMOJI_MART_MAX_RESULTS = 90;

/** An Emojisense search session whose results are emoji-mart emoji objects. */
export function createEmojiMartSearch(options: EmojiMartSearchOptions): EmojiMartSearch {
  const { data, engine, semantic, locale, limit = EMOJI_MART_MAX_RESULTS, debounceMs, onResults } = options;
  const index = createEmojiMartIndex(data);
  return createSearchSession({
    engine,
    semantic,
    locale,
    limit,
    debounceMs,
    onChange: (state) => onResults(toEmojiMart(state.results, index), state),
  });
}

/** The part of emoji-mart's exported `SearchIndex` that its picker calls. */
export interface SearchIndexLike {
  search(value: string, options?: { maxResults?: number; caller?: string }): Promise<unknown>;
}

export interface OverrideSearchIndexOptions {
  data: EmojiMartData;
  engine: AliasEngine;
  locale?: string;
}

/**
 * EXPERIMENTAL: make emoji-mart's own search box rank with the on-device Emojisense dictionary.
 *
 * emoji-mart 5 has no search hook, but its picker calls `SearchIndex.search(value)` through the
 * exported object on every input (verified in 5.6.0), so replacing that method changes what it
 * shows. This relies on that internal detail. Only layer 0 is used: the picker renders one
 * answer per keystroke and has no way to fuse in semantic results that arrive later.
 * Queries without letters or digits (an emoji, used by `getEmojiDataFromNative`) still go to
 * emoji-mart's search. Returns a function that restores the original.
 */
export function overrideSearchIndex(searchIndex: SearchIndexLike, options: OverrideSearchIndexOptions) {
  const { data, engine, locale } = options;
  const index = createEmojiMartIndex(data);
  const original = searchIndex.search;
  searchIndex.search = async function search(value, searchOptions = {}) {
    if (typeof value !== "string" || normalize(value) === "") {
      return original.call(this, value, searchOptions);
    }
    const limit = searchOptions.maxResults ?? EMOJI_MART_MAX_RESULTS;
    const { results } = engine.search(value, { limit, ...(locale ? { locale } : {}) });
    return toEmojiMart(results, index);
  };
  return () => {
    searchIndex.search = original;
  };
}
