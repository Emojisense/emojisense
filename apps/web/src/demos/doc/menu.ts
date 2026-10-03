import type { EmojiSuggestion, EmojiSuggestionProps, EmojiSuggestionRenderer } from "@emojisense/tiptap";
import type { AliasEngine } from "emojisense";
import type { DemoMessages } from "../../i18n/demos";
import { interpolate, splitTags } from "../../i18n/translate";
import { searchLocales } from "../../lib/engine-client";
import { type MeaningStage, promotedIds } from "../meaning";
import { describeEmoji, matchesFor } from "./describe";

export type DocMenuWords = DemoMessages["doc"]["menu"];

export interface DocMenuController {
  isOpen(): boolean;
  /** Position of an emoji (by hexcode) in the open menu, or -1. */
  indexOf(id: string): number;
  activeIndex(): number;
  /** "meaning" once meaning search has changed the list of the current query. */
  stage(): MeaningStage;
  /** Move the highlight, like ↓ / ↑. */
  move(step: number): void;
  /**
   * Insert the highlighted emoji in place of `:query`. Unlike Enter, it leaves focus where it
   * is, so the autoplay never pulls the page to the editor.
   */
  insertActive(): boolean;
}

export interface DocMenu {
  render: () => EmojiSuggestionRenderer;
  controller: DocMenuController;
}

let menuCount = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The `:` menu in the site's style: emoji, `:code:` and why it matched. Same contract and
 * keys as the package's default menu (an ARIA listbox; focus stays in the editor).
 */
export function createDocMenu(
  getEngine: () => AliasEngine | undefined,
  onPointerDown: () => void,
  words: DocMenuWords,
  locale: string,
): DocMenu {
  const keyHints: [keys: string[], action: string][] = [
    [["↑", "↓"], words.move],
    [["↵"], words.insert],
    [["esc"], words.close],
  ];
  const id = `doc-menu-${++menuCount}`;
  let root: HTMLElement | undefined;
  let heading: HTMLElement | undefined;
  let listbox: HTMLElement | undefined;
  let unmount: (() => void) | undefined;
  let props: EmojiSuggestionProps | undefined;
  let items: EmojiSuggestion[] = [];
  let query: string | undefined;
  let active = 0;
  /** Rows the latest answer for the same query added or moved up. They light once. */
  let promoted: ReadonlySet<string> = new Set();
  let stage: MeaningStage = "device";

  const optionId = (index: number) => `${id}-option-${index}`;
  const editorElement = () => props?.editor.view.dom;

  function build(): HTMLElement {
    const container = element("div", "doc-menu");
    heading = element("div", "doc-menu-head");
    heading.setAttribute("aria-hidden", "true");
    listbox = element("div", "doc-menu-list");
    listbox.id = id;
    listbox.setAttribute("role", "listbox");
    listbox.setAttribute("aria-label", words.label);
    const foot = element("div", "doc-menu-foot");
    foot.setAttribute("aria-hidden", "true");
    for (const [keys, action] of keyHints) {
      const hint = element("span", "");
      hint.append(...keys.map((key) => element("kbd", "", key)), ` ${action}`);
      foot.append(hint);
    }
    container.append(heading, listbox, foot);
    // Keep focus (and the caret) in the editor when the pointer presses a row.
    container.addEventListener("mousedown", (event) => event.preventDefault());
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("click", (event) => {
      const index = indexOfTarget(event.target);
      if (index !== undefined) choose(index);
    });
    container.addEventListener("mousemove", (event) => {
      const index = indexOfTarget(event.target);
      if (index !== undefined && index !== active) highlight(index);
    });
    return container;
  }

  function indexOfTarget(target: EventTarget | null): number | undefined {
    const option = target instanceof Element ? target.closest("[role=option]") : null;
    const index = option ? Number(option.getAttribute("data-index")) : Number.NaN;
    return Number.isInteger(index) ? index : undefined;
  }

  function renderRows() {
    if (!listbox || !heading) return;
    const engine = getEngine();
    const matches = engine && query ? matchesFor(engine, query, locale, searchLocales()) : new Map();
    const title = element("span", "doc-menu-title");
    title.append(
      ...splitTags(words.matching).map((part) => {
        const text = interpolate(part.text, { query: query ?? "" });
        return part.tag === "code" ? element("code", "", text) : text;
      }),
    );
    const badge = element("span", "meaning-badge", stage === "meaning" ? words.byMeaning : words.onDevice);
    badge.dataset.stage = stage;
    heading.replaceChildren(title, badge);
    listbox.replaceChildren(
      ...items.map((item, index) => {
        const info = engine
          ? describeEmoji(engine, item.id, item.source, matches.get(item.id), words, locale)
          : undefined;
        const row = element("div", promoted.has(item.id) ? "doc-menu-row meaning-promoted" : "doc-menu-row");
        row.id = optionId(index);
        row.setAttribute("role", "option");
        row.setAttribute("data-index", String(index));
        row.setAttribute("aria-label", info?.why ? `${item.label}, ${info.why}` : item.label);
        const emoji = element("span", "doc-menu-emoji emoji", item.emoji);
        emoji.setAttribute("aria-hidden", "true");
        row.append(emoji, element("span", "doc-menu-code", `:${info?.code ?? item.label}:`));
        if (info?.why) row.append(element("span", "doc-menu-why", info.why));
        return row;
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
    editorElement()?.setAttribute("aria-activedescendant", optionId(index));
  }

  function choose(index: number) {
    const item = items[index];
    if (item && props) props.command(item);
  }

  function show(next: EmojiSuggestionProps) {
    props = next;
    // While Tiptap fetches (a microtask for the alias engine) the current list stays on screen.
    if (next.loading) return;
    const previousId = items[active]?.id;
    const sameQuery = next.query === query;
    promoted = sameQuery
      ? promotedIds(
          items.map((item) => item.id),
          next.items.map((item) => item.id),
        )
      : new Set();
    if (!sameQuery) stage = "device";
    if (promoted.size > 0 || next.items.some((item) => item.source === "semantic")) stage = "meaning";
    items = next.items;
    query = next.query;
    if (items.length === 0) {
      hide();
      return;
    }
    // Late semantic results keep the highlighted emoji; a new query starts at the top.
    const kept = sameQuery ? items.findIndex((item) => item.id === previousId) : -1;
    active = kept >= 0 ? kept : 0;
    root ??= build();
    if (!unmount) {
      unmount = next.mount(root);
      const editor = editorElement();
      editor?.setAttribute("aria-controls", id);
      editor?.setAttribute("aria-autocomplete", "list");
    }
    renderRows();
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
    if (items.length > 0) highlight((active + step + items.length) % items.length);
  }

  const renderer: EmojiSuggestionRenderer = {
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
          // Tiptap then exits the suggestion and keeps the typed text.
          hide();
          return true;
        default:
          return false;
      }
    },
  };

  const controller: DocMenuController = {
    isOpen: () => unmount !== undefined,
    indexOf: (emojiId) => (unmount ? items.findIndex((item) => item.id === emojiId) : -1),
    activeIndex: () => active,
    stage: () => stage,
    move,
    insertActive() {
      const item = items[active];
      if (!unmount || !item || !props) return false;
      const { view } = props.editor;
      view.dispatch(view.state.tr.insertText(item.emoji, props.range.from, props.range.to));
      return true;
    },
  };

  return { render: () => renderer, controller };
}
