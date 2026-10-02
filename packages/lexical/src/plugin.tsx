import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  type MenuRenderFn,
  type TriggerFn,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { type AliasEngine, applySkinTone, type SemanticProvider, type SkinTone } from "emojisense";
import {
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  type CommandListenerPriority,
  KEY_DOWN_COMMAND,
  type TextNode,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EmojiMenu, EmojiOption } from "./menu.js";
import { registerShortcodeTransform } from "./shortcodes.js";
import {
  createSuggestionSource,
  type EmojiSuggestion,
  findShortcode,
  type SuggestionSource,
} from "./source.js";

export interface EmojiAutocompletePluginProps {
  /** Ranks the menu. The plugin stays inactive while it is `undefined` (packs still loading). */
  engine: AliasEngine | undefined;
  /** Semantic results, debounced and fused into the open menu. Omit for alias-only. */
  semantic?: SemanticProvider | undefined;
  /** Preferred locale for ranking and labels. Default: the engine's first pack. */
  locale?: string;
  /** Menu size. Default 8. */
  limit?: number;
  /** Delay before a semantic request. Default 200 ms. */
  debounceMs?: number;
  /** Applied to inserted (and shown) emoji. Default "none". */
  skinTone?: SkinTone;
  /** Default ":". */
  trigger?: string;
  /** Characters after the trigger before the menu opens. Default 1. */
  minQueryLength?: number;
  /** Replace a typed `:name:` (exact shortcode or name) with its emoji. Default true. */
  shortcodes?: boolean;
  /** Accessible name of the default menu. Default "Emoji suggestions". */
  ariaLabel?: string;
  /** Replace the default menu. Called only while there is at least one result. */
  menuRenderFn?: MenuRenderFn<EmojiOption>;
  /** Class name for the element Lexical positions at the caret. */
  anchorClassName?: string;
  /**
   * Priority of the open menu's key handlers (Enter, Tab, arrows, Escape). Default
   * `COMMAND_PRIORITY_CRITICAL`, so the menu gets these keys before tables (HIGH), code blocks and
   * other plugins. The menu returns every key while it is closed.
   */
  commandPriority?: CommandListenerPriority;
}

/**
 * Lexical's typeahead punctuation minus "+", "-" and "_", which appear in shortcodes
 * (":+1", ":sweat_smile"). ":" stays, so a completed ":name:" closes the menu.
 */
const QUERY_PUNCTUATION = "\\.,\\*\\?\\$\\@\\|#{}\\(\\)\\^\\[\\]\\\\/!%'\"~=<>:;";

const NO_RESULTS: { query: string | null; suggestions: EmojiSuggestion[] } = { query: null, suggestions: [] };

/** `:` emoji autocomplete for Lexical, ranked by Emojisense. Render inside `LexicalComposer`. */
export function EmojiAutocompletePlugin(props: EmojiAutocompletePluginProps) {
  const {
    engine,
    semantic,
    locale,
    limit,
    debounceMs,
    skinTone = "none",
    trigger = ":",
    minQueryLength = 1,
    shortcodes = true,
    ariaLabel,
    menuRenderFn,
    anchorClassName,
    commandPriority = COMMAND_PRIORITY_CRITICAL,
  } = props;
  const [editor] = useLexicalComposerContext();
  const [results, setResults] = useState(NO_RESULTS);

  const source = useMemo(
    () =>
      engine &&
      createSuggestionSource({
        engine,
        semantic,
        locale,
        limit,
        debounceMs,
        onLateResults: (query, suggestions) =>
          setResults((current) => (current.query === query ? { query, suggestions } : current)),
      }),
    [engine, semantic, locale, limit, debounceMs],
  );
  useEffect(() => () => source?.dispose(), [source]);

  // Lexical reports the query after every editor update, also when only the selection moved.
  const searched = useRef<{ source: SuggestionSource | undefined; query: string | null }>({
    source: undefined,
    query: null,
  });
  const onQueryChange = useCallback(
    (query: string | null) => {
      if (searched.current.source === source && searched.current.query === query) return;
      searched.current = { source, query };
      setResults(query === null || !source ? NO_RESULTS : { query, suggestions: source.search(query) });
    },
    [source],
  );

  const options = useMemo(
    () =>
      results.suggestions.map(
        (suggestion) => new EmojiOption({ ...suggestion, emoji: applySkinTone(suggestion.emoji, skinTone) }),
      ),
    [results, skinTone],
  );
  const visible = options.length > 0;

  // Escape closes the menu and keeps the text. Like Tiptap, it then stays closed for that
  // trigger until the user leaves it, instead of reopening on the next character.
  const matchAt = useRef<string | null>(null);
  const dismissedAt = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  // KEY_DOWN_COMMAND comes before KEY_ESCAPE_COMMAND whatever the menu's `commandPriority` is.
  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.key === "Escape" && visibleRef.current) dismissedAt.current = matchAt.current;
          return false; // the typeahead's own handler closes the menu
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor],
  );

  const basicTrigger = useBasicTypeaheadTriggerMatch(trigger, {
    minLength: minQueryLength,
    punctuation: QUERY_PUNCTUATION,
  });
  const triggerFn = useCallback<TriggerFn>(
    (text, triggerEditor) => {
      const match = source ? basicTrigger(text, triggerEditor) : null;
      if (match === null) {
        matchAt.current = null;
        dismissedAt.current = null;
        return null;
      }
      // Runs inside an editor read, so the selection is available.
      const selection = $getSelection();
      matchAt.current = $isRangeSelection(selection) ? `${selection.anchor.key}:${match.leadOffset}` : null;
      return matchAt.current !== null && matchAt.current === dismissedAt.current ? null : match;
    },
    [basicTrigger, source],
  );

  const onSelectOption = useCallback((option: EmojiOption, query: TextNode | null, closeMenu: () => void) => {
    // Runs inside the typeahead's editor.update(); `query` holds exactly ":query".
    // The caret stays where the user typed, so the commit must not scroll the page to it.
    // The literal tag, not SKIP_SCROLL_INTO_VIEW_TAG: older supported Lexical versions lack it.
    $addUpdateTag("skip-scroll-into-view");
    const { emoji } = option.suggestion;
    if (query) {
      query.setTextContent(emoji);
      query.selectEnd();
    } else {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(emoji);
    }
    closeMenu();
  }, []);

  useEffect(() => {
    if (!shortcodes || !engine) return;
    return registerShortcodeTransform(editor, (code) => {
      const hit = findShortcode(engine, code, locale);
      return hit && applySkinTone(hit.emoji, skinTone);
    });
  }, [editor, engine, locale, shortcodes, skinTone]);

  const renderDefaultMenu = useCallback<MenuRenderFn<EmojiOption>>(
    (anchor, itemProps) =>
      anchor.current
        ? createPortal(<EmojiMenu {...itemProps} {...(ariaLabel ? { ariaLabel } : {})} />, anchor.current)
        : null,
    [ariaLabel],
  );

  return (
    <LexicalTypeaheadMenuPlugin<EmojiOption>
      options={options}
      onQueryChange={onQueryChange}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      // Without a render function and with no options, the typeahead draws nothing and lets every
      // key reach the editor: that is "no results, menu closed". Late semantic results reopen it.
      menuRenderFn={visible ? (menuRenderFn ?? renderDefaultMenu) : undefined}
      commandPriority={commandPriority}
      {...(anchorClassName ? { anchorClassName } : {})}
    />
  );
}
