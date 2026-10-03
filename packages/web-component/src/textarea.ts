import { applySkinTone, type SkinTone } from "emojisense";
import { type EmojiSuggestion, findTrigger, type SuggestionSource } from "emojisense/autocomplete";
import { caretRect } from "./caret.js";

type Field = HTMLTextAreaElement | HTMLInputElement;

/** A value, or a getter for values that change after the autocomplete is attached. */
export type Dynamic<T> = T | (() => T);

export interface TextareaAutocompleteOptions {
  /** Ranks the menu. Pass a getter while the packs load: the menu stays closed until it returns one. */
  source: Dynamic<SuggestionSource | undefined>;
  /** The user's skin tone, applied to the inserted emoji. */
  skinTone?: Dynamic<SkinTone | undefined>;
  /** A longer query is a sentence: the menu closes. Default 4. */
  maxWords?: number;
  /** Accessible name of the menu. Default "Emoji suggestions". */
  ariaLabel?: string;
  /** Extra class names for the menu element. */
  className?: string;
  /** Where the menu element goes. Default: the document body. */
  container?: HTMLElement;
  /** Called after an emoji replaced the `:query`. */
  onInsert?: (emoji: string) => void;
}

export interface TextareaAutocomplete {
  /** Read the text before the caret again, e.g. after the app changed the value. */
  refresh(): void;
  close(): void;
  destroy(): void;
}

interface Match {
  /** Index of the colon in the field's value. */
  start: number;
  /** The caret. */
  end: number;
}

let menuCount = 0;

/**
 * `:` emoji autocomplete for a plain `<textarea>` or text `<input>`: a listbox menu next to the
 * caret, ↑ ↓ to move, Enter or Tab to insert, Escape to close. Queries may contain spaces
 * (`:ship it`). Style it with `@emojisense/web-component/textarea.css` or your own CSS.
 */
export function attachEmojiAutocomplete(
  field: Field,
  options: TextareaAutocompleteOptions,
): TextareaAutocomplete {
  const doc = field.ownerDocument;
  const view = doc.defaultView ?? window;
  const maxWords = options.maxWords ?? 4;
  const read = <T>(value: Dynamic<T>): T => (typeof value === "function" ? (value as () => T)() : value);

  const menu = doc.createElement("div");
  menu.id = `emojisense-textarea-menu-${++menuCount}`;
  menu.className = ["emojisense-menu", "emojisense-textarea-menu", options.className]
    .filter(Boolean)
    .join(" ");
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", options.ariaLabel ?? "Emoji suggestions");
  menu.style.position = "absolute";
  menu.style.display = "none";

  let suggestions: EmojiSuggestion[] = [];
  let active = 0;
  let match: Match | undefined;
  /** The colon of a `:query` closed with Escape: the menu stays closed for it. */
  let dismissed: number | undefined;
  /** Drops late results of a query the user typed past. */
  let generation = 0;

  const isOpen = () => menu.style.display !== "none";

  const setActive = (index: number) => {
    active = index;
    menu.querySelectorAll<HTMLElement>("[role=option]").forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === index));
      if (i === index) {
        field.setAttribute("aria-activedescendant", option.id);
        scrollIntoMenu(menu, option);
      }
    });
  };

  const close = () => {
    generation++;
    match = undefined;
    suggestions = [];
    menu.style.display = "none";
    field.removeAttribute("aria-activedescendant");
    field.removeAttribute("aria-controls");
  };

  const place = () => {
    const container = options.container ?? doc.body;
    const caret = caretRect(field);
    const origin =
      container === doc.body
        ? { left: -view.scrollX, top: -view.scrollY }
        : {
            left: container.getBoundingClientRect().left - container.scrollLeft,
            top: container.getBoundingClientRect().top - container.scrollTop,
          };
    const height = menu.offsetHeight;
    const below = caret.bottom + height <= view.innerHeight || caret.top - height < 0;
    menu.style.left = `${caret.left - origin.left}px`;
    menu.style.top = `${(below ? caret.bottom : caret.top - height) - origin.top}px`;
  };

  const render = (next: EmojiSuggestion[], keepActive: boolean) => {
    const activeId = keepActive ? suggestions[active]?.id : undefined;
    suggestions = next;
    if (next.length === 0) {
      menu.style.display = "none";
      field.removeAttribute("aria-activedescendant");
      return;
    }
    const tone = options.skinTone === undefined ? undefined : read(options.skinTone);
    menu.replaceChildren(
      ...next.map((suggestion, index) => {
        const option = doc.createElement("div");
        option.id = `${menu.id}-${index}`;
        option.className = "emojisense-menu__option";
        option.setAttribute("role", "option");
        option.dataset.index = String(index);
        option.dataset.source = suggestion.source;
        const emoji = doc.createElement("span");
        emoji.className = "emojisense-menu__emoji";
        emoji.setAttribute("aria-hidden", "true");
        emoji.textContent = tone ? applySkinTone(suggestion.emoji, tone) : suggestion.emoji;
        const label = doc.createElement("span");
        label.className = "emojisense-menu__label";
        label.textContent = suggestion.context
          ? `${suggestion.label} · ${suggestion.context}`
          : suggestion.label;
        option.append(emoji, label);
        return option;
      }),
    );
    if (!menu.isConnected) (options.container ?? doc.body).append(menu);
    menu.style.display = "";
    field.setAttribute("aria-controls", menu.id);
    const kept = activeId === undefined ? -1 : next.findIndex((s) => s.id === activeId);
    setActive(kept >= 0 ? kept : 0);
    place();
  };

  const update = () => {
    const source = read(options.source);
    const caret = field.selectionStart ?? 0;
    if (!source || field.selectionEnd !== caret) return close();
    const { value } = field;
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const lineEnd = value.indexOf("\n", caret) === -1 ? value.length : value.indexOf("\n", caret);
    const found = findTrigger(value.slice(lineStart, caret), value.slice(caret, lineEnd), { maxWords });
    if (!found) {
      dismissed = undefined;
      return close();
    }
    const start = lineStart + found.start;
    if (dismissed === start) return;
    dismissed = undefined;
    match = { start, end: caret };
    const current = ++generation;
    // A new query starts at its best row; late rows of the same query keep the highlighted emoji.
    render(source.search(found.query), false);
    source.settled().then((final) => {
      if (current === generation) render(final, true);
    });
  };

  const choose = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion || !match) return;
    const tone = options.skinTone === undefined ? undefined : read(options.skinTone);
    const emoji = tone ? applySkinTone(suggestion.emoji, tone) : suggestion.emoji;
    const { start, end } = match;
    close();
    field.focus();
    field.setRangeText(emoji, start, end, "end");
    // Frameworks listen for input events to read the new value.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    options.onInsert?.(emoji);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !isOpen() ||
      suggestions.length === 0 ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    const count = suggestions.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      choose(active);
    } else if (event.key === "Escape") {
      dismissed = match?.start;
      close();
      // A dialog around the field should not close too.
      event.stopPropagation();
    } else {
      return;
    }
    event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) update();
  };
  const onBlur = () => close();
  const onReposition = () => {
    if (isOpen()) place();
  };
  // Keep the focus in the field while the menu is used with the pointer.
  const onMenuPointerDown = (event: Event) => event.preventDefault();
  const onMenuClick = (event: Event) => {
    const option = (event.target as Element).closest<HTMLElement>("[role=option]");
    if (option) choose(Number(option.dataset.index));
  };
  const onMenuMove = (event: Event) => {
    const option = (event.target as Element).closest<HTMLElement>("[role=option]");
    if (option && Number(option.dataset.index) !== active) setActive(Number(option.dataset.index));
  };

  // One element type, so the listeners get typed events.
  const element: HTMLElement = field;
  field.setAttribute("aria-autocomplete", "list");
  element.addEventListener("input", update);
  element.addEventListener("click", update);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("keyup", onKeyUp);
  element.addEventListener("blur", onBlur);
  element.addEventListener("scroll", onReposition);
  view.addEventListener("resize", onReposition);
  menu.addEventListener("mousedown", onMenuPointerDown);
  menu.addEventListener("pointerdown", onMenuPointerDown);
  menu.addEventListener("click", onMenuClick);
  menu.addEventListener("pointermove", onMenuMove);

  return {
    refresh: update,
    close,
    destroy() {
      close();
      menu.remove();
      field.removeAttribute("aria-autocomplete");
      element.removeEventListener("input", update);
      element.removeEventListener("click", update);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("keyup", onKeyUp);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("scroll", onReposition);
      view.removeEventListener("resize", onReposition);
    },
  };
}

/** Scroll only the menu, never the page. */
function scrollIntoMenu(menu: HTMLElement, option: HTMLElement) {
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < menu.scrollTop) menu.scrollTop = top;
  else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
}
