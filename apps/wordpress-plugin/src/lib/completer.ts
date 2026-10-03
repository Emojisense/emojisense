import type { AliasEngine, SemanticProvider } from "emojisense";
import { allowContext, createSuggestionSource, type EmojiSuggestion, TRIGGER } from "emojisense/autocomplete";

export { allowContext, TRIGGER };

/** Shorter queries show nothing: ":)" and ":D" stay emoticons. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_OPTIONS = 8;

/** One row of the autocomplete list. Culture rows carry `context`: why the emoji fits. */
export type CompletionItem = EmojiSuggestion;

/** Whether a query is long enough to search. */
export function isSearchable(query: string): boolean {
  return Array.from(query.trim()).length >= MIN_QUERY_LENGTH;
}

export interface ItemSearchOptions {
  engine: AliasEngine;
  locale: string;
  /** Only phrases of these languages match (`searchLocales`). Default: every pack of the engine. */
  locales?: readonly string[] | undefined;
  semantic?: SemanticProvider | undefined;
  limit?: number;
  /** Delay before an API request. Default 250 ms. */
  debounceMs?: number;
  onItems: (items: CompletionItem[], query: string) => void;
}

export interface ItemSearch {
  update(query: string): void;
  dispose(): void;
}

/**
 * Alias results on every keystroke (synchronous), then, when the dictionary is unsure and search
 * by meaning is on, the API's results fused in. Culture results come from the engine's culture file.
 * Custom emoji are images, and the editors insert text only, so they are left out.
 */
export function createItemSearch(options: ItemSearchOptions): ItemSearch {
  const { engine, locale, locales, semantic, limit = MAX_OPTIONS, debounceMs = 250, onItems } = options;
  const source = createSuggestionSource({
    engine,
    locale,
    locales,
    semantic,
    limit,
    debounceMs,
    minQueryLength: MIN_QUERY_LENGTH,
    includeCustom: false,
    region: "device",
    onLateResults: (query, items) => onItems(items, query),
  });
  return {
    update(query) {
      onItems(source.search(query.trim()), query);
    },
    dispose: () => source.dispose(),
  };
}
