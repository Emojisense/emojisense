/**
 * Editor-agnostic autocomplete logic. Kept byte-identical in @emojisense/tiptap and
 * @emojisense/lexical so neither adapter depends on the other's editor; it belongs in core
 * once a second consumer needs it.
 */
import {
  type AliasEngine,
  createSearchSession,
  normalize,
  type ResultSource,
  type SearchResult,
  type SemanticProvider,
} from "emojisense";

/** One row of the autocomplete menu. */
export interface EmojiSuggestion {
  /** The emoji to insert, with the skin tone already applied by the editor adapter. */
  emoji: string;
  /** Emojibase hexcode of the base emoji, e.g. "1F996". */
  id: string;
  /** Display label in the preferred locale. */
  label: string;
  source: ResultSource;
}

export interface SuggestionSourceOptions {
  engine: AliasEngine;
  /** Omit for alias-only (offline) suggestions. */
  semantic?: SemanticProvider | undefined;
  locale?: string | undefined;
  /** Default 8: an inline menu, not a picker grid. */
  limit?: number | undefined;
  /** Delay before a semantic request. Default 200 ms (core default). */
  debounceMs?: number | undefined;
  /** Fused semantic results for a query that `search` answered earlier. */
  onLateResults?: (query: string, suggestions: EmojiSuggestion[]) => void;
}

export interface SuggestionSource {
  /** Alias suggestions for this keystroke, synchronously. Fused results follow via `onLateResults`. */
  search(query: string): EmojiSuggestion[];
  dispose(): void;
}

export const DEFAULT_LIMIT = 8;

/** `:name:` right before the caret, after a line start, whitespace or "(". */
export const SHORTCODE_BEFORE_CARET = /(?<=^|[\s(]):([^\s:]+):$/u;

/** Wrap core's search session: alias results on every keystroke, semantic results fused later. */
export function createSuggestionSource(options: SuggestionSourceOptions): SuggestionSource {
  const { engine, semantic, locale, limit = DEFAULT_LIMIT, debounceMs, onLateResults } = options;
  let immediate: EmojiSuggestion[] = [];
  let searching = false;
  const session = createSearchSession({
    engine,
    semantic,
    locale,
    limit,
    debounceMs,
    onChange: (state) => {
      if (searching) {
        immediate = state.results.map((result) => toSuggestion(engine, result, locale));
        return;
      }
      // Later "alias" / "error" states repeat the alias results the menu already shows.
      if (state.status === "fused") {
        onLateResults?.(
          state.query,
          state.results.map((result) => toSuggestion(engine, result, locale)),
        );
      }
    },
  });

  return {
    search(query) {
      searching = true;
      try {
        session.update(query);
      } finally {
        searching = false;
      }
      return immediate;
    },
    dispose: () => session.dispose(),
  };
}

/**
 * Resolve a completed `:name:` the way chat apps do: only an exact shortcode or emoji name
 * counts ("fire", "+1", "sweat_smile"), never a fuzzy or partial match.
 */
export function findShortcode(
  engine: AliasEngine,
  code: string,
  locale?: string,
): EmojiSuggestion | undefined {
  const normalized = normalize(code);
  if (normalized === "") return undefined;
  const { results } = engine.search(code, {
    prefix: false,
    limit: DEFAULT_LIMIT,
    ...(locale ? { locale } : {}),
  });
  const hit = results.find(
    (result) => (result.field === "shortcode" || result.field === "name") && result.match === normalized,
  );
  return hit && toSuggestion(engine, hit, locale);
}

function toSuggestion(
  engine: AliasEngine,
  result: SearchResult,
  locale: string | undefined,
): EmojiSuggestion {
  // Semantic results carry no label, so every label comes from the engine for consistency.
  const labels = engine.get(result.id)?.labels ?? {};
  const label = labels[locale ?? ""] || labels[engine.locales[0] ?? ""] || result.emoji;
  return { emoji: result.emoji, id: result.id, label, source: result.source };
}
