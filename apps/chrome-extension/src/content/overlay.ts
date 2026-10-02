import type { PickerItem, ResultStatus } from "../shared/messages";
import type { Strings } from "../shared/strings";
import { type Placement, placeOverlay, type Size } from "./position";
import { SURFACE_CSS } from "./styles";
import { createSurface } from "./surface";
import type { Rect } from "./target";
import type { Theme } from "./theme";

/** Columns of the result grid; arrow-key moves depend on it (keep in sync with overlay.css). */
export const COLUMNS = 8;

/** Used for placement until the panel has been laid out once. */
const NOMINAL_SIZE: Size = { width: 376, height: 320 };
/** Placeholder tiles while the index loads: two rows, as many as the recent emoji. */
const SKELETON_TILES = 16;
const FOCUS_GRACE_MS = 500;
const MAX_REFOCUS = 2;
const SVG_NS = "http://www.w3.org/2000/svg";

export type DismissReason = "escape" | "outside";

/** What the status line above the results says. */
export type StatusState = "loading" | "recent" | "found" | "searching" | "empty" | "offline";

const EMPTY_EMOJI = "🫥";

export interface PickerOptions {
  document: Document;
  /** Parent element for the shadow host. */
  mount: Element;
  strings: Strings;
  /** "copy" when there is no field to insert into (canvas editors, Google Docs). */
  mode: "insert" | "copy";
  /** "⌘V" or "Ctrl+V", for the copy-mode hint. */
  pasteKey: string;
  /** The page's scheme around the field; without it the picker follows the system setting. */
  theme?: Theme | undefined;
  onQuery(query: string): void;
  onPick(item: PickerItem, how: { copy: boolean }): void;
  onDismiss(reason: DismissReason): void;
}

export interface Picker {
  readonly host: HTMLElement;
  /** Exposed for tests; the root is closed to page scripts. */
  readonly root: ShadowRoot;
  setResults(query: string, status: ResultStatus, items: readonly PickerItem[]): void;
  setUnavailable(): void;
  position(anchor: Rect | null): void;
  focus(): void;
  destroy(): void;
}

/** Events that must not reach page handlers (React roots, "click outside" closers, shortcuts). */
const CONTAINED_EVENTS = [
  "click",
  "dblclick",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "beforeinput",
  "input",
  "focusin",
  "focusout",
  "paste",
  "copy",
  "cut",
  "wheel",
] as const;
const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

/**
 * Combobox + listbox (WAI-ARIA APG pattern): focus stays in the search box, arrow keys move the
 * active option through `aria-activedescendant`, Enter picks, Escape closes.
 */
export function createPicker(options: PickerOptions): Picker {
  const { document: doc, strings } = options;
  const defaultView = doc.defaultView;
  if (!defaultView) throw new Error("emojisense: the picker needs a document with a window");
  const view: Window = defaultView;

  const surface = createSurface(doc, options.mount, SURFACE_CSS);
  const { host, root } = surface;

  const panel = element(doc, "div", {
    class: "surface panel",
    role: "dialog",
    "aria-label": strings.dialogLabel,
  });
  if (options.theme) panel.dataset.theme = options.theme;
  const search = element(doc, "div", { class: "search" });
  const input = element(doc, "input", {
    class: "query",
    type: "text",
    role: "combobox",
    "aria-expanded": "false",
    "aria-controls": "es-list",
    "aria-autocomplete": "list",
    "aria-label": strings.searchLabel,
    "aria-describedby": "es-help",
    placeholder: strings.placeholder,
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
  });
  search.append(searchIcon(doc), input);
  const status = element(doc, "p", { class: "status" });
  const statusText = element(doc, "span", { class: "status-text" });
  status.append(element(doc, "span", { class: "status-dot", "aria-hidden": "true" }), statusText);
  const skeleton = element(doc, "div", { class: "skeleton", "aria-hidden": "true" });
  for (let i = 0; i < SKELETON_TILES; i++) skeleton.append(element(doc, "span", {}));
  const list = element(doc, "ul", {
    class: "grid",
    role: "listbox",
    id: "es-list",
    "aria-label": strings.resultsLabel,
  });
  const empty = element(doc, "div", { class: "empty" });
  const emptyEmoji = element(doc, "span", { class: "empty-emoji", "aria-hidden": "true" });
  const emptyText = element(doc, "p", { class: "empty-text" });
  empty.append(emptyEmoji, emptyText);
  empty.hidden = true;
  const footer = element(doc, "div", { class: "footer" });
  const preview = element(doc, "span", { class: "preview", "aria-hidden": "true" });
  const previewGlyph = element(doc, "span", { class: "preview-glyph" });
  const previewLabel = element(doc, "span", { class: "preview-label" });
  const previewTag = element(doc, "span", { class: "preview-tag" });
  previewTag.textContent = strings.semanticTag;
  previewTag.hidden = true;
  const previewHex = element(doc, "span", { class: "hex" });
  preview.append(previewGlyph, previewLabel, previewTag, previewHex);
  const hint = element(doc, "span", { class: "hint", "aria-hidden": "true" });
  hint.append(
    ...(options.mode === "copy"
      ? [keyHint(doc, "↵", strings.keyCopy), keyHint(doc, options.pasteKey, "", strings.keyThen)]
      : [keyHint(doc, "↵", strings.keyInsert), keyHint(doc, "esc", strings.keyClose)]),
  );
  footer.append(preview, hint);
  const help = element(doc, "p", { class: "visually-hidden", id: "es-help" });
  help.textContent = strings.keyboardHelp;
  const live = element(doc, "div", { class: "visually-hidden", role: "status", "aria-live": "polite" });

  panel.append(search, status, skeleton, list, empty, footer, help, live);
  root.append(panel);
  setStatus("loading", strings.loading);

  let items: readonly PickerItem[] = [];
  let active = -1;
  let destroyed = false;
  let anchor: Rect | null = null;
  let side: Placement["side"] | undefined;

  function place(): void {
    // Layout size, not getBoundingClientRect: the entry animation scales the panel.
    const measured = { width: panel.offsetWidth, height: panel.offsetHeight };
    const size = measured.width > 0 && measured.height > 0 ? measured : NOMINAL_SIZE;
    const viewport = { width: view.innerWidth, height: view.innerHeight };
    // Keep the side chosen first while it fits, so the panel does not jump as results change.
    const placement = placeOverlay(anchor, size, viewport, side);
    side = placement.side;
    panel.dataset.side = placement.side;
    surface.moveTo(placement.top, placement.left);
  }

  function setStatus(state: StatusState, text: string): void {
    status.dataset.state = state;
    statusText.textContent = text;
    skeleton.hidden = state !== "loading";
  }

  function showEmpty(text: string | undefined): void {
    empty.hidden = text === undefined;
    emptyEmoji.textContent = text === undefined ? "" : EMPTY_EMOJI;
    emptyText.textContent = text ?? "";
  }

  function renderItems(next: readonly PickerItem[]): void {
    items = next;
    list.replaceChildren(
      ...next.map((item, index) => {
        const option = element(doc, "li", {
          class: "option",
          role: "option",
          id: `es-option-${index}`,
          "aria-selected": "false",
          "aria-label": item.source === "semantic" ? `${item.label}, ${strings.semanticMark}` : item.label,
          title: item.label,
          "data-index": String(index),
          "data-source": item.source,
        });
        const glyph = element(doc, "span", { class: "glyph", "aria-hidden": "true" });
        glyph.textContent = item.emoji;
        option.append(glyph);
        return option;
      }),
    );
    // Combobox pattern: "expanded" means the listbox is on screen, and an empty one is hidden.
    input.setAttribute("aria-expanded", String(next.length > 0));
    setActive(next.length > 0 ? 0 : -1, false);
  }

  function setActive(index: number, scroll: boolean): void {
    list.children[active]?.setAttribute("aria-selected", "false");
    active = index;
    const option = list.children[active];
    const item = items[active];
    if (!option || !item) {
      input.removeAttribute("aria-activedescendant");
      previewGlyph.textContent = "";
      previewLabel.textContent = "";
      previewTag.hidden = true;
      previewHex.textContent = "";
      return;
    }
    option.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", option.id);
    previewGlyph.textContent = item.emoji;
    previewLabel.textContent = item.label;
    previewTag.hidden = item.source !== "semantic";
    previewHex.textContent = item.id;
    if (scroll && typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
  }

  /** Grid moves: ±1 along a row, ±COLUMNS between rows. Returns false when nothing moved. */
  function move(delta: number): boolean {
    if (items.length === 0) return false;
    const last = items.length - 1;
    let next = active + delta;
    if (next > last) {
      // From a full row onto a shorter last row: land on its last tile instead of staying put.
      const onLastRow = Math.floor(active / COLUMNS) === Math.floor(last / COLUMNS);
      next = delta > 0 && !onLastRow ? last : active;
    }
    if (next < 0) next = active;
    setActive(next, true);
    return true;
  }

  function pick(index: number, copy: boolean): boolean {
    const item = items[index];
    if (!item) return false;
    options.onPick(item, { copy });
    return true;
  }

  function handleKey(event: KeyboardEvent): void {
    // During IME composition (Turkish dead keys, CJK) the keys belong to the input method.
    if (event.isComposing || event.keyCode === 229) return;
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        handled = move(COLUMNS);
        break;
      case "ArrowUp":
        handled = move(-COLUMNS);
        break;
      case "ArrowRight":
        handled = move(1);
        break;
      case "ArrowLeft":
        handled = move(-1);
        break;
      case "Enter":
        handled = pick(active, event.shiftKey);
        break;
      case "Escape":
      case "Tab":
        options.onDismiss("escape");
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  const fromPicker = (event: Event) => event.composedPath().includes(host);

  // Page shortcut handlers see the host (not an input) as the key target, so "s" or "/" would
  // trigger them. A window capture listener runs before document and element listeners.
  const onKey = (event: Event) => {
    if (!fromPicker(event)) return;
    event.stopImmediatePropagation();
    if (event.type === "keydown") handleKey(event as KeyboardEvent);
  };
  const onOutsidePointer = (event: Event) => {
    if (!fromPicker(event)) options.onDismiss("outside");
  };
  const contain = (event: Event) => event.stopPropagation();

  for (const type of KEY_EVENTS) view.addEventListener(type, onKey, true);
  view.addEventListener("pointerdown", onOutsidePointer, true);
  for (const type of CONTAINED_EVENTS) root.addEventListener(type, contain);

  input.addEventListener("input", () => options.onQuery(input.value));
  const openedAt = performance.now();
  let refocusAttempts = 0;
  input.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as Node | null;
    // null = the window lost focus (another app); keep the picker for when the user returns.
    if (!next || root.contains(next) || next === host || destroyed) return;
    // Some editors pull focus back to their field when it blurs. Right after opening that is
    // the page reacting to us, not the user leaving: take focus back, a bounded number of times.
    if (performance.now() - openedAt < FOCUS_GRACE_MS && refocusAttempts < MAX_REFOCUS) {
      refocusAttempts++;
      queueMicrotask(() => {
        if (!destroyed) input.focus({ preventScroll: true });
      });
      return;
    }
    options.onDismiss("outside");
  });
  // Tiles are not focusable; keep focus (and the caret) in the search box while clicking.
  const keepFocus = (event: Event) => event.preventDefault();
  list.addEventListener("pointerdown", keepFocus);
  list.addEventListener("mousedown", keepFocus);
  list.addEventListener("pointermove", (event) => {
    const index = optionIndex(event.target);
    if (index !== undefined && index !== active) setActive(index, false);
  });
  list.addEventListener("click", (event) => {
    const index = optionIndex(event.target);
    if (index !== undefined) pick(index, event.shiftKey);
  });

  return {
    host,
    root,
    setResults(query, resultStatus, next) {
      // Answers for an older query arrive after newer keystrokes; drop them.
      if (destroyed || query !== input.value) return;
      renderItems(next);
      const count = strings.resultCount(next.length);
      if (resultStatus === "recent") {
        setStatus("recent", strings.recent);
        showEmpty(undefined);
      } else if (resultStatus === "loading") {
        setStatus(
          "searching",
          next.length > 0 ? `${count} · ${strings.searchingMeaning}` : strings.searchingMeaning,
        );
        showEmpty(undefined);
      } else if (next.length > 0) {
        setStatus("found", count);
        showEmpty(undefined);
      } else {
        setStatus("empty", strings.noMatch);
        showEmpty(strings.noMatchHelp);
      }
      if (resultStatus !== "recent") {
        live.textContent = next.length > 0 ? count : resultStatus === "loading" ? "" : strings.noMatch;
      }
      // The height changed; above the caret, the panel must grow upwards, not over the text.
      place();
    },
    setUnavailable() {
      if (destroyed) return;
      renderItems([]);
      setStatus("offline", strings.unavailable);
      showEmpty(undefined);
      live.textContent = strings.unavailable;
      place();
    },
    position(next) {
      anchor = next;
      place();
    },
    focus() {
      input.focus({ preventScroll: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const type of KEY_EVENTS) view.removeEventListener(type, onKey, true);
      view.removeEventListener("pointerdown", onOutsidePointer, true);
      surface.remove();
    },
  };
}

function optionIndex(target: EventTarget | null): number | undefined {
  const option = (target as Element | null)?.closest?.("[data-index]");
  const index = Number(option?.getAttribute("data-index"));
  return option && Number.isInteger(index) ? index : undefined;
}

/** "↵ insert", or with `before` "then ⌘V": one key and its action, kept on one line. */
function keyHint(doc: Document, key: string, after: string, before = ""): HTMLElement {
  const pair = doc.createElement("span");
  pair.className = "key";
  const cap = doc.createElement("kbd");
  cap.textContent = key;
  pair.append(...[before, cap, after].filter((part) => part !== ""));
  return pair;
}

function searchIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "search-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const lens = doc.createElementNS(SVG_NS, "circle");
  lens.setAttribute("cx", "7");
  lens.setAttribute("cy", "7");
  lens.setAttribute("r", "4.75");
  const handle = doc.createElementNS(SVG_NS, "path");
  handle.setAttribute("d", "m10.5 10.5 3.25 3.25");
  svg.append(lens, handle);
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
