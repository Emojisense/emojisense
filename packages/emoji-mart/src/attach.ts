import { type EmojiMartEmoji, type EmojiMartSelection, toSelection } from "./map.js";
import { createEmojiMartSearch, type EmojiMartSearchOptions } from "./search.js";

export interface AttachEmojisenseOptions extends Omit<EmojiMartSearchOptions, "onResults"> {
  /** emoji-mart's picker element, created with `searchPosition: "none"`. Hidden while results show. */
  picker: HTMLElement;
  /** Your search input. It becomes the ARIA combobox. */
  input: HTMLInputElement;
  /** An empty element next to the picker for the ranked results. It becomes the ARIA listbox. */
  results: HTMLElement;
  /** Same payload as emoji-mart's `onEmojiSelect`. */
  onEmojiSelect: (selection: EmojiMartSelection, event: Event) => void;
  /** Results per row for arrow-key moves. Default 9, emoji-mart's `perLine`. */
  columns?: number;
  /** The emoji-mart skin (1–6) to select, e.g. `() => Store.get("skin") ?? 1`. Default 1. */
  skin?: () => number;
  /** Content of each result. Default: the native emoji. Return an `<em-emoji>` for image sets. */
  renderEmoji?: (emoji: EmojiMartEmoji, selection: EmojiMartSelection) => Node | string;
}

let instances = 0;

/**
 * Drive an emoji-mart picker from your own search input. An empty query shows emoji-mart's
 * picker; a typed query hides it and shows the Emojisense ranking in `results`, with the same
 * `onEmojiSelect` contract. emoji-mart has no search hook, so this is the supported integration.
 */
export function attachEmojisense(options: AttachEmojisenseOptions): { dispose(): void } {
  const {
    picker,
    input,
    results,
    onEmojiSelect,
    columns = 9,
    skin = () => 1,
    renderEmoji = (_emoji, selection) => selection.native,
    limit = 36,
    ...searchOptions
  } = options;
  results.id ||= `emojisense-results-${++instances}`;
  const pickerDisplay = picker.style.display;
  let emojis: EmojiMartEmoji[] = [];
  let optionElements: HTMLElement[] = [];
  let active = -1;

  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "Emoji results");
  results.dataset.emojisenseResults = "";
  results.style.display = "none";
  results.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", results.id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";

  const setActive = (index: number) => {
    const previous = optionElements[active];
    previous?.setAttribute("aria-selected", "false");
    previous?.removeAttribute("data-active");
    active = index;
    const option = optionElements[active];
    option?.setAttribute("aria-selected", "true");
    option?.setAttribute("data-active", "");
    if (option) input.setAttribute("aria-activedescendant", option.id);
    else input.removeAttribute("aria-activedescendant");
  };

  const render = (next: EmojiMartEmoji[], query: string) => {
    const searching = query.trim() !== "";
    // Inline display, not `hidden`: a page rule like `display: grid` would override `hidden`.
    picker.style.display = searching ? "none" : pickerDisplay;
    results.style.display = searching ? "grid" : "none";
    results.toggleAttribute("data-empty", searching && next.length === 0);
    emojis = searching ? next : [];
    active = -1;
    optionElements = emojis.map((emoji, index) => {
      const selection = toSelection(emoji, skin());
      const option = document.createElement("div");
      option.id = `${results.id}-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.setAttribute("aria-label", emoji.name);
      option.dataset.index = String(index);
      option.append(renderEmoji(emoji, selection));
      return option;
    });
    results.replaceChildren(...optionElements);
    input.setAttribute("aria-expanded", String(emojis.length > 0));
    setActive(emojis.length > 0 ? 0 : -1);
  };

  const search = createEmojiMartSearch({
    ...searchOptions,
    limit,
    onResults: (next, state) => render(next, state.query),
  });

  const select = (index: number, event: Event) => {
    const emoji = emojis[index];
    if (emoji) onEmojiSelect(toSelection(emoji, skin()), event);
  };

  const onInput = () => search.update(input.value);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    const move = moves[event.key];
    if (move !== undefined && emojis.length > 0) {
      event.preventDefault();
      setActive(Math.min(emojis.length - 1, Math.max(0, active + move)));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      select(active, event);
    } else if (event.key === "Escape" && input.value !== "") {
      event.preventDefault();
      input.value = "";
      search.update("");
    }
  };
  const indexOf = (event: Event) => {
    const option = (event.target as Element | null)?.closest?.("[role=option]");
    return option instanceof HTMLElement ? Number(option.dataset.index) : -1;
  };
  const onPointerOver = (event: Event) => {
    const index = indexOf(event);
    if (index >= 0 && index !== active) setActive(index);
  };
  // Keep focus in the input when a result is clicked.
  const onMouseDown = (event: Event) => event.preventDefault();
  const onClick = (event: Event) => {
    const index = indexOf(event);
    if (index >= 0) select(index, event);
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  results.addEventListener("pointerover", onPointerOver);
  results.addEventListener("mousedown", onMouseDown);
  results.addEventListener("click", onClick);
  if (input.value) search.update(input.value);

  return {
    dispose() {
      search.dispose();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      results.removeEventListener("pointerover", onPointerOver);
      results.removeEventListener("mousedown", onMouseDown);
      results.removeEventListener("click", onClick);
      results.replaceChildren();
      results.style.display = "none";
      picker.style.display = pickerDisplay;
      input.removeAttribute("aria-activedescendant");
      input.setAttribute("aria-expanded", "false");
    },
  };
}
