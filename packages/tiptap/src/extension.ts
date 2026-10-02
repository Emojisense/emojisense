import { type Editor, Extension, InputRule, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import { type AliasEngine, applySkinTone, type SemanticProvider, type SkinTone } from "emojisense";
import { createEmojiMenu, type EmojiSuggestionProps, type EmojiSuggestionRenderer } from "./menu.js";
import {
  createSuggestionSource,
  DEFAULT_LIMIT,
  type EmojiSuggestion,
  findShortcode,
  SHORTCODE_BEFORE_CARET,
  type SuggestionSource,
} from "./source.js";

/** A value, or a getter for values that change after the editor is created. */
export type Dynamic<T> = T | (() => T);

export interface EmojiAutocompleteOptions {
  /**
   * Ranks the menu. Pass a getter (`() => sense.engine`) to create the editor before the packs
   * have loaded, or to pick up the idle-loaded extension packs; the menu stays closed while the
   * getter returns `undefined`.
   */
  engine: Dynamic<AliasEngine | undefined>;
  /** Semantic results, debounced and fused into the open menu. Omit for alias-only. */
  semantic: Dynamic<SemanticProvider | undefined>;
  /** Preferred locale for ranking and labels. Default: the engine's first pack. */
  locale: string | undefined;
  /** Menu size. Default 8. */
  limit: number;
  /** Delay before a semantic request. Default 200 ms. */
  debounceMs: number;
  /** Applied to inserted (and shown) emoji. A getter follows a user preference. */
  skinTone: Dynamic<SkinTone>;
  /** Default ":". */
  char: string;
  /** Characters after the trigger before the menu opens. Default 1. */
  minQueryLength: number;
  /** Replace a typed `:name:` (exact shortcode or name) with its emoji. Default true. */
  shortcodes: boolean;
  /** Menu renderer; default {@link createEmojiMenu}. Same contract as Tiptap's suggestion `render`. */
  render: () => EmojiSuggestionRenderer;
  pluginKey: PluginKey;
}

interface EmojiAutocompleteStorage {
  dispose: (() => void) | undefined;
}

export const EmojiAutocompletePluginKey = new PluginKey("emojiAutocomplete");

/**
 * `:` emoji autocomplete for Tiptap, ranked by Emojisense. Built on `@tiptap/suggestion`.
 *
 * ```ts
 * EmojiAutocomplete.configure({ engine, semantic, skinTone: "medium" })
 * ```
 */
export const EmojiAutocomplete = Extension.create<EmojiAutocompleteOptions, EmojiAutocompleteStorage>({
  name: "emojiAutocomplete",
  // Above the default 100 (like Tiptap's Mention), so the open menu gets Enter, Tab and the arrows
  // before list items and other keymaps. The menu returns every key while it is closed.
  priority: 101,

  addOptions() {
    return {
      engine: undefined,
      semantic: undefined,
      locale: undefined,
      limit: DEFAULT_LIMIT,
      debounceMs: 200,
      skinTone: "none",
      char: ":",
      minQueryLength: 1,
      shortcodes: true,
      render: createEmojiMenu(),
      pluginKey: EmojiAutocompletePluginKey,
    };
  },

  addStorage() {
    return { dispose: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const renderer = options.render();
    // Tiptap renders once per query; fused semantic results arrive later, so the last props
    // are kept to re-render the same query with the new items.
    let shown: EmojiSuggestionProps | undefined;
    const sources = createSourceCache(options, (query, suggestions) => {
      if (!shown || shown.loading || shown.query !== query) return;
      shown = { ...shown, items: withSkinTone(suggestions, options.skinTone) };
      renderer.onUpdate?.(shown);
    });
    this.storage.dispose = sources.dispose;

    return [
      Suggestion<EmojiSuggestion, EmojiSuggestion>({
        editor: this.editor,
        pluginKey: options.pluginKey,
        char: options.char,
        allowedPrefixes: [" ", "("],
        minQueryLength: options.minQueryLength,
        decorationClass: "emojisense-query",
        items: ({ query }) => withSkinTone(sources.search(query), options.skinTone),
        command: ({ editor, range, props }) => insertEmoji(editor, range, props.emoji),
        render: () => ({
          onBeforeStart: (props) => renderer.onBeforeStart?.(props),
          onStart: (props) => {
            shown = props;
            renderer.onStart?.(props);
          },
          onBeforeUpdate: (props) => renderer.onBeforeUpdate?.(props),
          onUpdate: (props) => {
            shown = props;
            renderer.onUpdate?.(props);
          },
          onExit: (props) => {
            shown = undefined;
            renderer.onExit?.(props);
          },
          onKeyDown: (props) => renderer.onKeyDown?.(props) ?? false,
        }),
      }),
    ];
  },

  addInputRules() {
    const options = this.options;
    if (!options.shortcodes) return [];
    return [
      new InputRule({
        find: SHORTCODE_BEFORE_CARET,
        handler: ({ state, range, match }) => {
          const engine = resolve(options.engine);
          const code = match[1];
          const hit = engine && code ? findShortcode(engine, code, options.locale) : undefined;
          if (!hit) return null;
          // `range` covers ":name"; the closing ":" being typed is never inserted.
          state.tr.insertText(applySkinTone(hit.emoji, resolve(options.skinTone)), range.from, range.to);
        },
      }),
    ];
  },

  onDestroy() {
    this.storage.dispose?.();
  },
});

/** One search session per engine/provider pair, rebuilt when a getter returns a new instance. */
function createSourceCache(
  options: EmojiAutocompleteOptions,
  onLateResults: (query: string, suggestions: EmojiSuggestion[]) => void,
) {
  let current:
    | { engine: AliasEngine; semantic: SemanticProvider | undefined; source: SuggestionSource }
    | undefined;
  const dispose = () => {
    current?.source.dispose();
    current = undefined;
  };
  return {
    search(query: string): EmojiSuggestion[] {
      const engine = resolve(options.engine);
      if (!engine) return [];
      const semantic = resolve(options.semantic);
      if (current?.engine !== engine || current.semantic !== semantic) {
        dispose();
        current = {
          engine,
          semantic,
          source: createSuggestionSource({
            engine,
            semantic,
            locale: options.locale,
            limit: options.limit,
            debounceMs: options.debounceMs,
            onLateResults,
          }),
        };
      }
      return current.source.search(query);
    },
    dispose,
  };
}

function insertEmoji(editor: Editor, range: Range, emoji: string) {
  // insertText, not insertContent: the emoji is text (never parsed as HTML) and keeps the marks.
  // The caret stays where the user typed, so focusing must not scroll the page to the editor.
  editor
    .chain()
    .focus(null, { scrollIntoView: false })
    .command(({ tr }) => {
      tr.insertText(emoji, range.from, range.to);
      return true;
    })
    .run();
}

function withSkinTone(suggestions: EmojiSuggestion[], tone: Dynamic<SkinTone>): EmojiSuggestion[] {
  const skinTone = resolve(tone);
  if (skinTone === "none") return suggestions;
  return suggestions.map((suggestion) => ({
    ...suggestion,
    emoji: applySkinTone(suggestion.emoji, skinTone),
  }));
}

function resolve<T>(value: Dynamic<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}
