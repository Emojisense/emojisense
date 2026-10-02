import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { scrollOptionIntoView } from "./scroll.js";
import type { EmojiSuggestion } from "./source.js";

export type EmojiSuggestionProps = SuggestionProps<EmojiSuggestion, EmojiSuggestion>;

/** The `render()` result of a suggestion renderer, as Tiptap's suggestion utility defines it. */
export interface EmojiSuggestionRenderer {
  onBeforeStart?: (props: EmojiSuggestionProps) => void;
  onStart?: (props: EmojiSuggestionProps) => void;
  onBeforeUpdate?: (props: EmojiSuggestionProps) => void;
  onUpdate?: (props: EmojiSuggestionProps) => void;
  onExit?: (props: EmojiSuggestionProps) => void;
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean;
}

export interface EmojiMenuOptions {
  /** Accessible name of the listbox. Default "Emoji suggestions". */
  ariaLabel?: string;
  /** Extra class names for the listbox element (it always has `emojisense-menu`). */
  className?: string;
}

let menuCount = 0;

/**
 * The default menu: a framework-free ARIA listbox. Focus stays in the editor, which points at
 * the active option with `aria-activedescendant` (the combobox pattern for a text field).
 * Keys: ↑/↓ move, Enter/Tab insert, Escape closes and keeps the typed text.
 */
export function createEmojiMenu(options: EmojiMenuOptions = {}): () => EmojiSuggestionRenderer {
  const { ariaLabel = "Emoji suggestions", className } = options;

  return () => {
    const id = `emojisense-menu-${++menuCount}`;
    let listbox: HTMLElement | undefined;
    let unmount: (() => void) | undefined;
    let props: EmojiSuggestionProps | undefined;
    let items: EmojiSuggestion[] = [];
    let query: string | undefined;
    let active = 0;

    const optionId = (index: number) => `${id}-option-${index}`;
    const editorElement = () => props?.editor.view.dom;

    function createListbox(): HTMLElement {
      const element = document.createElement("div");
      element.id = id;
      element.setAttribute("role", "listbox");
      element.setAttribute("aria-label", ariaLabel);
      element.className = className ? `emojisense-menu ${className}` : "emojisense-menu";
      // Keep focus (and the caret) in the editor when the pointer presses an option.
      element.addEventListener("mousedown", (event) => event.preventDefault());
      element.addEventListener("click", (event) => {
        const index = optionIndexOf(event.target);
        if (index !== undefined) choose(index);
      });
      element.addEventListener("mousemove", (event) => {
        const index = optionIndexOf(event.target);
        if (index !== undefined && index !== active) highlight(index);
      });
      return element;
    }

    function optionIndexOf(target: EventTarget | null): number | undefined {
      const option = target instanceof Element ? target.closest("[role=option]") : null;
      const index = option ? Number(option.getAttribute("data-index")) : Number.NaN;
      return Number.isInteger(index) ? index : undefined;
    }

    function renderOptions(element: HTMLElement) {
      element.replaceChildren(
        ...items.map((item, index) => {
          const option = document.createElement("div");
          option.id = optionId(index);
          option.setAttribute("role", "option");
          option.setAttribute("data-index", String(index));
          option.setAttribute("data-source", item.source);
          option.className = "emojisense-menu__option";
          const emoji = document.createElement("span");
          emoji.className = "emojisense-menu__emoji";
          emoji.setAttribute("aria-hidden", "true");
          emoji.textContent = item.emoji;
          const label = document.createElement("span");
          label.className = "emojisense-menu__label";
          label.textContent = item.label;
          option.append(emoji, label);
          return option;
        }),
      );
      highlight(active);
    }

    function highlight(index: number) {
      active = index;
      if (!listbox) return;
      for (const option of listbox.children) {
        option.setAttribute("aria-selected", String(option.id === optionId(index)));
      }
      const option = listbox.children[index];
      if (option instanceof HTMLElement) scrollOptionIntoView(listbox, option);
      editorElement()?.setAttribute("aria-activedescendant", optionId(index));
    }

    function choose(index: number) {
      const item = items[index];
      if (item && props) props.command(item);
    }

    function show(next: EmojiSuggestionProps) {
      props = next;
      // While Tiptap fetches (a microtask for the alias engine) keep the current list on screen.
      if (next.loading) return;
      const previousId = items[active]?.id;
      const sameQuery = next.query === query;
      items = next.items;
      query = next.query;
      if (items.length === 0) {
        hide();
        return;
      }
      // Late semantic results keep the highlighted emoji; a new query starts at the top.
      const kept = sameQuery ? items.findIndex((item) => item.id === previousId) : -1;
      active = kept >= 0 ? kept : 0;
      listbox ??= createListbox();
      if (!unmount) {
        unmount = next.mount(listbox);
        const editor = editorElement();
        editor?.setAttribute("aria-controls", id);
        editor?.setAttribute("aria-autocomplete", "list");
      }
      renderOptions(listbox);
    }

    function hide() {
      unmount?.();
      unmount = undefined;
      const editor = editorElement();
      editor?.removeAttribute("aria-controls");
      editor?.removeAttribute("aria-activedescendant");
      editor?.removeAttribute("aria-autocomplete");
    }

    function move(step: number) {
      highlight((active + step + items.length) % items.length);
    }

    return {
      onStart: show,
      onUpdate: show,
      onExit() {
        hide();
        props = undefined;
        items = [];
        query = undefined;
      },
      onKeyDown({ event }) {
        // With nothing on screen every key belongs to the editor (Enter makes a new line).
        if (!unmount || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
        switch (event.key) {
          case "ArrowDown":
            move(1);
            return true;
          case "ArrowUp":
            move(-1);
            return true;
          case "Enter":
          case "Tab":
            if (event.shiftKey) return false;
            choose(active);
            return true;
          case "Escape":
            // Tiptap then exits the suggestion without touching the typed text.
            hide();
            return true;
          default:
            return false;
        }
      },
    };
  };
}
