import { applySkinTone, type SkinTone } from "emojisense";
import {
  DEFAULT_LIMIT,
  type EmojiSuggestion,
  findTrigger,
  type SuggestionSource,
  TRIGGER,
} from "emojisense/autocomplete";
import type { Ui } from "tinymce";

type AutocompleterSpec = Ui.InlineContent.AutocompleterSpec;
type AutocompleterItem = Ui.InlineContent.AutocompleterItemSpec;

const TEXT_NODE = 3;

export interface AutocompleterOptions {
  /** The suggestion source. The menu stays closed while it returns `undefined` (packs loading). */
  source: () => SuggestionSource | undefined;
  /** The user's skin tone, read on every query. */
  skinTone?: () => SkinTone | undefined;
  /** Menu size. Default 8. */
  limit?: number;
  /** A longer query is a sentence: the menu closes. Default 4. */
  maxWords?: number;
  /** Put the emoji in place of the `:query` range. */
  insert: (range: Range, emoji: string) => void;
}

/**
 * The `:` autocompleter spec for `editor.ui.registry.addAutocompleter`. Queries may contain spaces
 * (`:ship it`). TinyMCE shows every answer in the order it arrives, so each answer is the one of
 * the newest query.
 */
export function createAutocompleter(options: AutocompleterOptions): AutocompleterSpec {
  const { limit = DEFAULT_LIMIT, maxWords = 4 } = options;
  let latest: Promise<AutocompleterItem[]> | undefined;

  return {
    type: "autocompleter",
    trigger: TRIGGER,
    // ":)" and ":D" stay emoticons.
    minChars: 2,
    columns: 1,
    maxResults: limit,
    matches: (range, _text, query) => {
      const { before, after } = textAround(range);
      return findTrigger(`${before}${TRIGGER}${query}`, after, { maxWords }) !== undefined;
    },
    fetch: (query) => {
      const source = options.source();
      if (!source) return Promise.resolve([]);
      const tone = options.skinTone?.();
      const current = source.resolve(query).then((suggestions) => suggestions.map((s) => toItem(s, tone)));
      latest = current;
      return current.then((items) => (latest === current || !latest ? items : latest));
    },
    onAction: (api, range, value) => {
      options.insert(range, value);
      api.hide();
    },
  };
}

/** The text before the colon and after the caret, in their text nodes. */
function textAround(range: Range): { before: string; after: string } {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const before =
    startContainer.nodeType === TEXT_NODE ? (startContainer as Text).data.slice(0, startOffset) : "";
  const after = endContainer.nodeType === TEXT_NODE ? (endContainer as Text).data.slice(endOffset) : "";
  return { before, after };
}

function toItem(suggestion: EmojiSuggestion, tone: SkinTone | undefined): AutocompleterItem {
  const emoji = tone ? applySkinTone(suggestion.emoji, tone) : suggestion.emoji;
  return {
    type: "autocompleteitem",
    value: emoji,
    text: suggestion.context ? `${suggestion.label} · ${suggestion.context}` : suggestion.label,
    // TinyMCE draws an unknown icon name as markup, as its emoticons plugin does with the emoji.
    icon: escapeHtml(emoji),
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
