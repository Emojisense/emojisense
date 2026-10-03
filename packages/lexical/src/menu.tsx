import { MenuOption } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { EmojiSuggestion } from "emojisense/autocomplete";
import { useLayoutEffect, useRef } from "react";
import { scrollOptionIntoView } from "./scroll.js";

/** A menu row for Lexical's typeahead. `key` is the emoji's hexcode. */
export class EmojiOption extends MenuOption {
  readonly suggestion: EmojiSuggestion;

  constructor(suggestion: EmojiSuggestion) {
    super(suggestion.id);
    this.suggestion = suggestion;
    this.title = suggestion.label;
  }
}

export interface EmojiMenuProps {
  options: EmojiOption[];
  selectedIndex: number | null;
  selectOptionAndCleanUp: (option: EmojiOption) => void;
  setHighlightedIndex: (index: number) => void;
  /** Accessible name of the list. Default "Emoji suggestions". */
  ariaLabel?: string;
}

/**
 * The default menu. Lexical's anchor element is the `role="listbox"`: the editor's
 * `aria-controls` points at it and its `aria-activedescendant` uses the `typeahead-item-<n>` ids,
 * so the rows keep those ids. A labelled group names the list without nesting a second listbox.
 *
 * The rows do not register `option.setRefElement`: with it, Lexical calls `scrollIntoView` on
 * the active row, which also scrolls the page. The menu scrolls only its own list instead.
 */
export function EmojiMenu(props: EmojiMenuProps) {
  const { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex } = props;
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const option = selectedIndex === null ? undefined : list?.children[selectedIndex];
    if (list && option instanceof HTMLElement) scrollOptionIntoView(list, option);
  }, [selectedIndex]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a listbox may only hold options or groups; a <fieldset> would add form semantics and UA styling to a popup.
    <div
      ref={listRef}
      className="emojisense-menu"
      role="group"
      aria-label={props.ariaLabel ?? "Emoji suggestions"}
    >
      {options.map((option, index) => (
        <button
          key={option.key}
          type="button"
          role="option"
          id={`typeahead-item-${index}`}
          aria-selected={index === selectedIndex}
          tabIndex={-1}
          className="emojisense-menu__option"
          data-source={option.suggestion.source}
          // Keep focus (and the caret) in the editor when the pointer presses an option.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (index !== selectedIndex) setHighlightedIndex(index);
          }}
          onClick={() => {
            setHighlightedIndex(index);
            selectOptionAndCleanUp(option);
          }}
        >
          <span className="emojisense-menu__emoji" aria-hidden="true">
            {option.suggestion.emoji}
          </span>
          <span className="emojisense-menu__label">{option.suggestion.label}</span>
        </button>
      ))}
    </div>
  );
}
