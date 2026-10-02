import {
  type AliasEngine,
  createSearchSession,
  deviceRegion,
  type ResultSource,
  type SearchResult,
  type SemanticProvider,
} from "emojisense";

/** The character that starts an emoji search in the editor. */
export const TRIGGER = ":";
/** Shorter queries show nothing: ":)" and ":D" stay emoticons. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_OPTIONS = 8;

/** One row of the autocomplete list. */
export interface CompletionItem {
  emoji: string;
  id: string;
  /** Emoji name in the configured locale (English when the locale has none). */
  label: string;
  source: ResultSource;
  /** Culture results: why the emoji fits ("Halloween"). */
  context?: string;
}

const OPENERS = /[\s([{"'“‘«]$/u;
const WORD_START = /^[\p{L}\p{N}_]/u;

/**
 * The colon starts a search only at the start of the text or after a space or an opening
 * bracket or quote, and not right before a word: "12:30", "https://" and "a:b" stay text.
 */
export function allowContext(before: string, after: string): boolean {
  if (before !== "" && !OPENERS.test(before)) return false;
  return !WORD_START.test(after);
}

/** Whether a query is long enough to search. */
export function isSearchable(query: string): boolean {
  return Array.from(query.trim()).length >= MIN_QUERY_LENGTH;
}

/** Search results as list rows: one row per emoji, named in the locale. */
export function toItems(
  results: readonly SearchResult[],
  engine: AliasEngine,
  locale: string,
  limit = MAX_OPTIONS,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    // Custom emoji (":party_parrot:") are images; the editors insert text only.
    if (result.source === "custom" || seen.has(result.emoji)) continue;
    seen.add(result.emoji);
    const labels = engine.get(result.id)?.labels ?? {};
    const context = (result as { context?: unknown }).context;
    items.push({
      emoji: result.emoji,
      id: result.id,
      label: labels[locale] ?? labels.en ?? "",
      source: result.source,
      ...(typeof context === "string" && context ? { context } : {}),
    });
    if (items.length >= limit) break;
  }
  return items;
}

export interface ItemSearchOptions {
  engine: AliasEngine;
  locale: string;
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
 */
export function createItemSearch(options: ItemSearchOptions): ItemSearch {
  const { engine, locale, semantic, limit = MAX_OPTIONS, debounceMs = 250, onItems } = options;
  const region = deviceRegion();
  const session = createSearchSession({
    engine,
    locale,
    limit: limit * 2,
    debounceMs,
    ...(semantic ? { semantic } : {}),
    ...(region ? { region } : {}),
    onChange: (state) => onItems(toItems(state.results, engine, locale, limit), state.query),
  });
  return {
    update(query) {
      if (isSearchable(query)) session.update(query.trim());
      else {
        session.update("");
        onItems([], query);
      }
    },
    dispose: () => session.dispose(),
  };
}
