/**
 * Editor-agnostic `:` autocomplete logic, shared by the editor adapters (Tiptap, Lexical,
 * CKEditor 5, TinyMCE), the textarea autocomplete and the WordPress and Discourse integrations.
 * No DOM: it runs wherever the engine runs.
 */
import { deviceRegion } from "./culture.js";
import type { AliasEngine, ResultSource, SearchResult } from "./engine.js";
import { normalize } from "./normalize.js";
import type { SemanticProvider } from "./provider.js";
import { createSearchSession, type SessionStatus } from "./session.js";

export {
  type ApiSemanticOptions,
  createApiSemantic,
  createEngineLoader,
  type EngineLoader,
  type EngineLoaderOptions,
} from "./engine-loader.js";

/** The character that starts an emoji search. */
export const TRIGGER = ":";
/** An inline menu, not a picker grid. */
export const DEFAULT_LIMIT = 8;
/** How long `resolve` waits for semantic results before it answers with the alias results. */
export const DEFAULT_WAIT_MS = 600;

/** `:name:` right before the caret, after a line start, whitespace or "(". */
export const SHORTCODE_BEFORE_CARET = /(?<=^|[\s(]):([^\s:]+):$/u;

/** One row of the autocomplete menu. */
export interface EmojiSuggestion {
  /** The emoji to insert (`:shortcode:` for a custom emoji). Adapters apply the skin tone. */
  emoji: string;
  /** Emojibase hexcode of the base emoji, e.g. "1F996"; `C-<emojiId>` for a custom emoji. */
  id: string;
  /** Display label in the preferred locale. */
  label: string;
  source: ResultSource;
  /** Culture results: why the emoji fits ("Halloween"). */
  context?: string;
  /** Custom emoji: the image to draw. */
  imageUrl?: string;
  /** Custom emoji: the shortcode without colons. */
  shortcode?: string;
}

export interface SuggestionSourceOptions {
  engine: AliasEngine;
  /** Omit for alias-only (offline) suggestions. */
  semantic?: SemanticProvider | undefined;
  locale?: string | undefined;
  /** Default 8. */
  limit?: number | undefined;
  /** Delay before a semantic request. Default 200 ms (core default). */
  debounceMs?: number | undefined;
  /** Shorter queries (in code points, spaces trimmed) give no suggestions. Default 1. */
  minQueryLength?: number | undefined;
  /** Custom emoji are images: leave them out where only text can be inserted. Default true. */
  includeCustom?: boolean | undefined;
  /** Region for regional culture entries. `"device"`: the region of the browser's language. */
  region?: string | undefined;
  /** Fused semantic results for a query that `search` answered earlier. */
  onLateResults?: ((query: string, suggestions: EmojiSuggestion[]) => void) | undefined;
}

export interface ResolveOptions {
  /** Default 600 ms. */
  waitMs?: number;
}

export interface SuggestionSource {
  /** Alias suggestions for this keystroke, synchronously. Fused results follow via `onLateResults`. */
  search(query: string): EmojiSuggestion[];
  /**
   * For editors that take a promise per query: the alias suggestions when the dictionary is
   * sure, else the fused suggestions once they arrive (at most `waitMs` later). A newer `search`
   * or `resolve` answers an older pending one with its alias suggestions.
   */
  resolve(query: string, options?: ResolveOptions): Promise<EmojiSuggestion[]>;
  /**
   * The final suggestions of the last `search`: at once when the dictionary was sure, else the
   * fused ones (at most `waitMs` later). Show `search` results now, then these.
   */
  settled(options?: ResolveOptions): Promise<EmojiSuggestion[]>;
  dispose(): void;
}

interface Pending {
  query: string;
  fallback: EmojiSuggestion[];
  resolve: (suggestions: EmojiSuggestion[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Wrap core's search session: alias results on every keystroke, semantic results fused later. */
export function createSuggestionSource(options: SuggestionSourceOptions): SuggestionSource {
  const {
    engine,
    semantic,
    locale,
    limit = DEFAULT_LIMIT,
    debounceMs,
    minQueryLength = 1,
    includeCustom = true,
    onLateResults,
  } = options;
  const region = options.region === "device" ? deviceRegion() : options.region;
  const toSuggestions = (results: readonly SearchResult[]) =>
    toSuggestionList(results, engine, locale, limit, includeCustom);

  let immediate: EmojiSuggestion[] = [];
  let status: SessionStatus = "idle";
  let searching = false;
  let lastQuery = "";
  let pending: Pending | undefined;

  const settle = (suggestions?: EmojiSuggestion[]) => {
    if (!pending) return;
    const { resolve, fallback, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    resolve(suggestions ?? fallback);
  };

  const session = createSearchSession({
    engine,
    locale,
    // Room for the rows that toSuggestionList drops (duplicates, custom emoji).
    limit: limit * 2,
    ...(semantic ? { semantic } : {}),
    ...(debounceMs !== undefined ? { debounceMs } : {}),
    ...(region ? { region } : {}),
    onChange: (state) => {
      if (searching) {
        immediate = toSuggestions(state.results);
        status = state.status;
        return;
      }
      // Later "alias" / "error" states repeat the alias results the menu already shows.
      const late = state.status === "fused" ? toSuggestions(state.results) : undefined;
      if (pending?.query === state.query) settle(late);
      if (late) onLateResults?.(state.query, late);
    },
  });

  const search = (query: string): EmojiSuggestion[] => {
    settle();
    const searchable = Array.from(query.trim()).length >= minQueryLength;
    searching = true;
    try {
      session.update(searchable ? query : "");
    } finally {
      searching = false;
    }
    lastQuery = query;
    if (!searchable) immediate = [];
    return immediate;
  };

  const settled = ({ waitMs = DEFAULT_WAIT_MS }: ResolveOptions = {}): Promise<EmojiSuggestion[]> => {
    settle();
    const now = immediate;
    if (status !== "loading") return Promise.resolve(now);
    return new Promise((resolve) => {
      pending = { query: lastQuery, fallback: now, resolve, timer: setTimeout(() => settle(), waitMs) };
    });
  };

  return {
    search,
    resolve(query, options) {
      search(query);
      return settled(options);
    },
    settled,
    dispose() {
      settle();
      session.dispose();
    },
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

const OPENERS = /[\s([{"'“‘«]$/u;
const WORD_START = /^[\p{L}\p{N}_]/u;

/**
 * The colon starts a search only at the start of the text or after a space or an opening
 * bracket or quote, and not right before a word: "12:30", "https://" and "a:b" stay text.
 * `before`: the text before the colon. `after`: the text after the caret.
 */
export function allowContext(before: string, after: string): boolean {
  if (before !== "" && !OPENERS.test(before)) return false;
  return !WORD_START.test(after);
}

export interface TriggerOptions {
  /** A longer query is a sentence, not a search. Default 4. */
  maxWords?: number;
  /** In code points. Default 32. */
  maxLength?: number;
}

export interface TriggerMatch {
  /** The text between the colon and the caret. */
  query: string;
  /** Index of the colon in `before`. */
  start: number;
}

/**
 * The `:query` that ends at the caret, for editors without a trigger API (plain textareas,
 * TinyMCE's `matches`). Queries may contain spaces ("ship it") up to `maxWords` words.
 * `before`: the text of the line up to the caret. `after`: the text after the caret.
 */
export function findTrigger(
  before: string,
  after = "",
  { maxWords = 4, maxLength = 32 }: TriggerOptions = {},
): TriggerMatch | undefined {
  const start = before.lastIndexOf(TRIGGER);
  if (start < 0) return undefined;
  const query = before.slice(start + 1);
  if (/^\s|[\n\r]/u.test(query) || Array.from(query).length > maxLength) return undefined;
  if (query.split(/\s+/u).filter(Boolean).length > maxWords) return undefined;
  if (!allowContext(before.slice(0, start), after)) return undefined;
  return { query, start };
}

function toSuggestionList(
  results: readonly SearchResult[],
  engine: AliasEngine,
  locale: string | undefined,
  limit: number,
  includeCustom: boolean,
): EmojiSuggestion[] {
  const suggestions: EmojiSuggestion[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if ((!includeCustom && result.source === "custom") || seen.has(result.id)) continue;
    seen.add(result.id);
    suggestions.push(toSuggestion(engine, result, locale));
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

function toSuggestion(
  engine: AliasEngine,
  result: SearchResult,
  locale: string | undefined,
): EmojiSuggestion {
  // Semantic results carry no label, so every label comes from the engine for consistency.
  const labels = engine.get(result.id)?.labels ?? {};
  const label =
    labels[locale ?? ""] ||
    labels[engine.locales[0] ?? ""] ||
    labels.en ||
    Object.values(labels).find(Boolean) ||
    result.emoji;
  const context = (result as { context?: unknown }).context;
  return {
    emoji: result.emoji,
    id: result.id,
    label,
    source: result.source,
    ...(typeof context === "string" && context ? { context } : {}),
    ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
    ...(result.shortcode ? { shortcode: result.shortcode } : {}),
  };
}
