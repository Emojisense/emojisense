import {
  type AliasEngine,
  applySkinTone,
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  type EmojiEntry,
  groupLabel,
  loadPacks,
  type Pack,
  type SearchSession,
  type SessionState,
  type SessionStatus,
  SKIN_TONES,
  type SkinTone,
} from "emojisense";
import { type GridLayout, isGridKey, layoutRows, moveActive } from "./grid.js";
import { styles } from "./styles.js";

export interface EmojiSelectDetail {
  /** The emoji with the picker's skin tone applied. */
  emoji: string;
  /** Label in the picker's locale. */
  label: string;
  /** Emojibase hexcode of the base emoji, stable across skin tones (e.g. "1F44D"). */
  id: string;
}

export type EmojiSelectEvent = CustomEvent<EmojiSelectDetail>;

/** `idle`: no `pack-url` and no `packs` yet. */
export type PickerStatus = "idle" | "loading" | "ready" | "error";

declare global {
  // The event bubbles and is composed, so listeners on document or window get it typed too.
  interface GlobalEventHandlersEventMap {
    "emoji-select": EmojiSelectEvent;
  }
}

interface Item {
  emoji: string;
  id: string;
  label: string;
  hasSkinTones: boolean;
}

interface View {
  listbox: HTMLElement;
  items: Item[];
  options: HTMLElement[];
  /** Options per group, in order; rows never span two groups. */
  groupSizes: number[];
  layout: GridLayout;
  active: number;
}

const DEFAULT_COLUMNS = 9;
const MAX_COLUMNS = 24;
const DEFAULT_PLACEHOLDER = "Search emoji…";
const IDLE_TIMEOUT_MS = 2000;

const TEMPLATE = `<style>${styles}</style>
<div class="root" part="root">
  <div class="bar">
    <input class="search" part="search" type="search" role="combobox" aria-autocomplete="list"
      aria-expanded="false" aria-controls="browse" autocomplete="off" autocapitalize="off"
      spellcheck="false" enterkeyhint="done">
    <span class="pill" part="pill" aria-hidden="true" hidden></span>
  </div>
  <div class="viewport" part="viewport">
    <div class="listbox" part="listbox" role="listbox" id="browse" aria-label="Emoji"></div>
    <div class="listbox grid" part="listbox" role="listbox" id="results" aria-label="Emoji results" hidden></div>
    <p class="message" part="message" hidden>
      <span class="sticker" part="sticker" aria-hidden="true"></span><span class="message-text"></span>
    </p>
  </div>
  <div class="visually-hidden" role="status" aria-live="polite"></div>
</div>`;

/** Properties a framework may set before the element is defined (see #upgradeProperties). */
const UPGRADED_PROPERTIES = [
  "packUrl",
  "shardsUrl",
  "endpoint",
  "publishableKey",
  "locale",
  "columns",
  "skinTone",
  "placeholder",
  "packs",
] as const;

// Importing this module during server rendering must not throw.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<emojisense-picker>`: an emoji picker with Emojisense search. With an empty query it shows
 * every emoji by category. While typing it shows the ranked results: on-device alias results on
 * every keystroke, then shard or API results fused in when the dictionary is unsure.
 *
 * Attributes: `pack-url`, `shards-url`, `endpoint`, `key` (alias `publishable-key`), `locale`,
 * `columns`, `skin-tone`, `placeholder`. Event: `emoji-select` with `{ emoji, label, id }`.
 */
export class EmojisensePickerElement extends Base {
  static readonly observedAttributes = [
    "pack-url",
    "shards-url",
    "endpoint",
    "key",
    "publishable-key",
    "locale",
    "columns",
    "skin-tone",
    "placeholder",
  ];

  readonly #shadow: ShadowRoot;
  readonly #root: HTMLElement;
  readonly #input: HTMLInputElement;
  readonly #message: HTMLElement;
  readonly #sticker: HTMLElement;
  readonly #messageText: HTMLElement;
  readonly #pill: HTMLElement;
  readonly #live: HTMLElement;
  readonly #browse: View;
  readonly #results: View;
  #searching = false;
  #sessionStatus: SessionStatus = "idle";
  #status: PickerStatus = "idle";
  #packs: Pack[] | undefined;
  #engine: AliasEngine | undefined;
  #session: SearchSession | undefined;
  #packKey: unknown;
  #sessionKey: string | undefined;
  #loading: AbortController | undefined;
  #cancelIdle: (() => void) | undefined;
  #scheduled = false;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.innerHTML = TEMPLATE;
    const find = <T extends HTMLElement>(selector: string) => this.#shadow.querySelector(selector) as T;
    this.#root = find(".root");
    this.#input = find(".search");
    this.#message = find(".message");
    this.#sticker = find(".sticker");
    this.#messageText = find(".message-text");
    this.#pill = find(".pill");
    this.#live = find("[role=status]");
    this.#browse = emptyView(find("#browse"));
    this.#results = emptyView(find("#results"));
    this.#applyPlaceholder();
    this.#applyColumns();

    this.#input.addEventListener("input", () => this.#search(this.#input.value));
    this.#input.addEventListener("keydown", (event) => this.#onKeyDown(event));
    for (const view of [this.#browse, this.#results]) {
      view.listbox.addEventListener("pointerover", (event) => {
        const index = optionIndex(event);
        if (index >= 0 && index !== view.active) this.#setActive(view, index, false);
      });
      // Keep focus (and the caret) in the search input when an option is clicked.
      view.listbox.addEventListener("mousedown", (event) => event.preventDefault());
      view.listbox.addEventListener("click", (event) => {
        const index = optionIndex(event);
        if (index >= 0) this.#select(view, index);
      });
    }
  }

  get packUrl(): string {
    return this.getAttribute("pack-url") ?? "";
  }
  set packUrl(value: string) {
    this.setAttribute("pack-url", value);
  }

  get shardsUrl(): string {
    return this.getAttribute("shards-url") ?? "";
  }
  set shardsUrl(value: string) {
    this.setAttribute("shards-url", value);
  }

  get endpoint(): string {
    return this.getAttribute("endpoint") ?? "";
  }
  set endpoint(value: string) {
    this.setAttribute("endpoint", value);
  }

  /** The `key` attribute. `publishable-key` wins when both are set: React and Vue reserve `key`. */
  get publishableKey(): string {
    return this.getAttribute("publishable-key") ?? this.getAttribute("key") ?? "";
  }
  set publishableKey(value: string) {
    this.setAttribute("publishable-key", value);
  }

  get locale(): string {
    return this.getAttribute("locale") || "en";
  }
  set locale(value: string) {
    this.setAttribute("locale", value);
  }

  get columns(): number {
    const columns = Number.parseInt(this.getAttribute("columns") ?? "", 10);
    return Number.isInteger(columns) && columns > 0 ? Math.min(columns, MAX_COLUMNS) : DEFAULT_COLUMNS;
  }
  set columns(value: number) {
    this.setAttribute("columns", String(value));
  }

  get skinTone(): SkinTone {
    const tone = this.getAttribute("skin-tone");
    return SKIN_TONES.find((t) => t === tone) ?? "none";
  }
  set skinTone(value: SkinTone) {
    this.setAttribute("skin-tone", value);
  }

  get placeholder(): string {
    return this.getAttribute("placeholder") || DEFAULT_PLACEHOLDER;
  }
  set placeholder(value: string) {
    this.setAttribute("placeholder", value);
  }

  /** Packs to use instead of fetching `pack-url`, e.g. bundled with an offline app. */
  get packs(): Pack[] | undefined {
    return this.#packs;
  }
  set packs(value: Pack[] | undefined) {
    this.#packs = value;
    this.#schedule();
  }

  get status(): PickerStatus {
    return this.#status;
  }

  /** The alias engine once the packs are loaded. */
  get engine(): AliasEngine | undefined {
    return this.#engine;
  }

  get query(): string {
    return this.#input.value;
  }
  set query(value: string) {
    this.#input.value = value;
    this.#search(value);
  }

  override focus(options?: FocusOptions): void {
    this.#input.focus(options);
  }

  connectedCallback(): void {
    this.#upgradeProperties();
    this.#schedule();
  }

  disconnectedCallback(): void {
    if (this.#status === "loading") this.#packKey = undefined;
    this.#loading?.abort();
    this.#cancelIdle?.();
    this.#session?.dispose();
    this.#session = undefined;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === "columns") this.#applyColumns();
    else if (name === "skin-tone") this.#applySkinTone();
    else if (name === "placeholder") this.#applyPlaceholder();
    else this.#schedule();
  }

  /**
   * A framework may set a property before `customElements.define` runs. That value is an own
   * property that hides the accessor, so take it off and set it again through the accessor.
   */
  #upgradeProperties() {
    for (const property of UPGRADED_PROPERTIES) {
      if (!Object.hasOwn(this, property)) continue;
      const value = (this as Record<string, unknown>)[property];
      delete (this as Record<string, unknown>)[property];
      (this as Record<string, unknown>)[property] = value;
    }
  }

  /** Coalesce attribute changes (a framework often sets several at once) into one reconfigure. */
  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.isConnected) this.#configure();
    });
  }

  #configure() {
    const packKey = this.#packs ?? `${this.packUrl}\n${this.locale}`;
    if (packKey !== this.#packKey) {
      this.#packKey = packKey;
      if (this.#packs) this.#usePacks(this.#packs, true);
      else if (this.packUrl) void this.#load(this.packUrl, this.locale);
      else this.#reset();
      return;
    }
    this.#connectSession();
  }

  async #load(baseUrl: string, locale: string) {
    this.#loading?.abort();
    this.#cancelIdle?.();
    const controller = new AbortController();
    this.#loading = controller;
    const { signal } = controller;
    this.#setStatus("loading");
    try {
      const core = await loadPacks({ baseUrl, locales: [locale], signal });
      if (signal.aborted) return;
      this.#usePacks(core, true);
      // The extension (more aliases and typos) is about twice the size of the core pack.
      this.#cancelIdle = whenIdle(() => {
        loadPacks({ baseUrl, locales: [locale], signal, part: "ext" }).then(
          (ext) => {
            if (!signal.aborted) this.#usePacks([...core, ...ext], false);
          },
          () => {
            // Optional upgrade: the core packs keep working.
          },
        );
      });
    } catch {
      if (!signal.aborted) this.#setStatus("error");
    }
  }

  #usePacks(packs: Pack[], renderBrowse: boolean) {
    this.#engine = createEngine(packs);
    this.#status = "ready";
    if (renderBrowse) this.#renderBrowse();
    this.#sessionKey = undefined;
    this.#connectSession();
  }

  #reset() {
    this.#loading?.abort();
    this.#session?.dispose();
    this.#session = undefined;
    this.#engine = undefined;
    this.#fill(this.#browse, [], []);
    this.#setStatus("idle");
  }

  /** (Re)create the search session when the engine or the semantic layers change. */
  #connectSession() {
    const engine = this.#engine;
    if (!engine) return;
    const key = [this.shardsUrl, this.endpoint, this.publishableKey, this.locale].join("\n");
    if (this.#session && key === this.#sessionKey) return;
    this.#session?.dispose();
    this.#sessionKey = key;
    this.#session = createSearchSession({
      engine,
      semantic: createLayeredSemantic({
        shardsUrl: this.shardsUrl || undefined,
        endpoint: this.endpoint || undefined,
        key: this.publishableKey || undefined,
        packVersion: engine.packVersion,
      }),
      locale: this.locale,
      onChange: (state) => this.#showResults(state),
    });
    this.#search(this.#input.value);
  }

  #search(query: string) {
    if (this.#session) this.#session.update(query);
    else if (query.trim() === "") this.#showResults(undefined);
  }

  #renderBrowse() {
    const engine = this.#engine;
    if (!engine) return;
    const fragment = document.createDocumentFragment();
    const items: Item[] = [];
    const groupSizes: number[] = [];
    let grid: HTMLElement | undefined;
    let group: string | undefined;
    for (const entry of engine.entries) {
      if (!grid || entry.group !== group) {
        group = entry.group;
        const labelId = `group-${groupSizes.length}`;
        const section = element("div", { class: "group", part: "group", role: "group" });
        section.setAttribute("aria-labelledby", labelId);
        // aria-hidden: the label names the group; read inside the listbox it would be noise.
        const label = element("div", { class: "group-label", part: "group-label", id: labelId });
        label.setAttribute("aria-hidden", "true");
        label.textContent = groupLabel(group, this.locale);
        grid = element("div", { class: "grid" });
        section.append(label, grid);
        fragment.append(section);
        groupSizes.push(0);
      }
      items.push(this.#itemOf(entry));
      groupSizes[groupSizes.length - 1] = (groupSizes.at(-1) ?? 0) + 1;
      grid.append(this.#option("b", items.length - 1, items.at(-1) as Item));
    }
    this.#browse.listbox.replaceChildren(fragment);
    const options = [...this.#browse.listbox.querySelectorAll<HTMLElement>("[role=option]")];
    Object.assign(this.#browse, { items, options, groupSizes, active: -1 });
    this.#browse.layout = layoutRows(groupSizes, this.columns);
    this.#showResults(undefined);
  }

  /** Render a session state; `undefined` shows the browse view. */
  #showResults(state: SessionState | undefined) {
    const searching = state !== undefined && state.query.trim() !== "";
    this.#searching = searching;
    this.#sessionStatus = state?.status ?? "idle";
    this.#browse.listbox.hidden = searching;
    this.#results.listbox.hidden = !searching;
    if (searching) {
      const engine = this.#engine;
      const items = state.results.map((result) => {
        const entry = engine?.get(result.id);
        return entry ? this.#itemOf(entry) : { ...result, label: result.emoji, hasSkinTones: false };
      });
      // Only tiles that were not on screen yet pop in, so typing does not re-animate the grid.
      const shown = new Set(this.#results.items.map((item) => item.id));
      const options = items.map((item, index) => {
        const option = this.#option("r", index, item);
        if (!shown.has(item.id)) {
          option.dataset.new = "";
          option.style.setProperty("--i", String(index));
        }
        return option;
      });
      this.#results.listbox.replaceChildren(...options);
      this.#fill(this.#results, items, options);
      if (items.length > 0) this.#setActive(this.#results, 0, false);
      this.#live.textContent =
        state.status === "loading" && items.length === 0 ? "" : `${items.length} results`;
    } else {
      this.#live.textContent = "";
    }
    this.#updateMessage();
    this.#syncCombobox();
  }

  #fill(view: View, items: Item[], options: HTMLElement[]) {
    if (view === this.#browse) view.listbox.replaceChildren(...options);
    Object.assign(view, { items, options, groupSizes: [items.length], active: -1 });
    view.layout = layoutRows(view.groupSizes, this.columns);
  }

  #itemOf(entry: EmojiEntry): Item {
    return {
      emoji: entry.emoji,
      id: entry.id,
      label: entry.labels[this.locale] ?? entry.labels.en ?? entry.emoji,
      hasSkinTones: entry.hasSkinTones,
    };
  }

  #option(prefix: string, index: number, item: Item): HTMLElement {
    const option = element("div", {
      class: "option",
      part: "option",
      role: "option",
      id: `${prefix}${index}`,
    });
    option.setAttribute("aria-selected", "false");
    option.setAttribute("aria-label", item.label);
    option.title = item.label;
    option.dataset.index = String(index);
    option.textContent = this.#glyph(item);
    return option;
  }

  #glyph(item: Item): string {
    return item.hasSkinTones ? applySkinTone(item.emoji, this.skinTone) : item.emoji;
  }

  #view(): View {
    return this.#searching ? this.#results : this.#browse;
  }

  #setActive(view: View, index: number, scroll: boolean) {
    const previous = view.options[view.active];
    if (previous) {
      previous.setAttribute("aria-selected", "false");
      previous.setAttribute("part", "option");
    }
    view.active = index;
    const next = view.options[index];
    if (next) {
      next.setAttribute("aria-selected", "true");
      next.setAttribute("part", "option active");
      if (scroll) next.scrollIntoView?.({ block: "nearest" });
    }
    this.#syncCombobox();
  }

  #syncCombobox() {
    const view = this.#view();
    this.#input.setAttribute("aria-controls", view.listbox.id);
    this.#input.setAttribute("aria-expanded", String(view.items.length > 0));
    const active = view.options[view.active];
    if (active) this.#input.setAttribute("aria-activedescendant", active.id);
    else this.#input.removeAttribute("aria-activedescendant");
  }

  #updateMessage() {
    const count = this.#results.items.length;
    const pending = this.#sessionStatus === "loading";
    let text = "";
    let sticker = "";
    if (this.#status === "loading" && !this.#engine) text = "Loading…";
    else if (this.#status === "error") [text, sticker] = ["Could not load emoji.", "🙈"];
    else if (this.#searching && count === 0) {
      [text, sticker] = pending ? ["Searching…", ""] : ["No emoji found.", "🫥"];
    }
    this.#messageText.textContent = text;
    this.#sticker.textContent = sticker;
    this.#message.hidden = text === "";

    // The pill shows the query state next to the input; the live region speaks it.
    this.#pill.hidden = !this.#searching;
    this.#pill.dataset.state = count > 0 ? "found" : pending ? "loading" : "none";
    this.#pill.textContent = count > 0 ? `${count} found${pending ? " …" : ""}` : pending ? "…" : "none";
  }

  #setStatus(status: PickerStatus) {
    this.#status = status;
    this.#updateMessage();
  }

  #onKeyDown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const view = this.#view();
    if (isGridKey(event.key)) {
      if (view.items.length === 0) return;
      event.preventDefault();
      this.#setActive(view, moveActive(view.layout, view.active, event.key), true);
    } else if (event.key === "Enter") {
      if (view.active < 0) return;
      event.preventDefault();
      this.#select(view, view.active);
    } else if (event.key === "Escape" && this.#input.value !== "") {
      // The first Escape clears the query. The next one reaches the host, e.g. to close a popover.
      event.preventDefault();
      event.stopPropagation();
      this.query = "";
    }
  }

  #select(view: View, index: number) {
    const item = view.items[index];
    if (!item) return;
    const detail: EmojiSelectDetail = { emoji: this.#glyph(item), label: item.label, id: item.id };
    this.dispatchEvent(new CustomEvent("emoji-select", { detail, bubbles: true, composed: true }));
  }

  #applyColumns() {
    this.#root.style.setProperty("--columns", String(this.columns));
    for (const view of [this.#browse, this.#results]) view.layout = layoutRows(view.groupSizes, this.columns);
  }

  #applySkinTone() {
    for (const view of [this.#browse, this.#results]) {
      view.items.forEach((item, index) => {
        const option = view.options[index];
        if (option && item.hasSkinTones) option.textContent = this.#glyph(item);
      });
    }
  }

  #applyPlaceholder() {
    this.#input.placeholder = this.placeholder;
    this.#input.setAttribute("aria-label", this.placeholder);
  }
}

function emptyView(listbox: HTMLElement): View {
  return { listbox, items: [], options: [], groupSizes: [], layout: layoutRows([], 1), active: -1 };
}

function element(tag: string, attributes: Record<string, string>): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function optionIndex(event: Event): number {
  const option = (event.target as Element | null)?.closest?.("[role=option]");
  return option instanceof HTMLElement ? Number(option.dataset.index) : -1;
}

function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(callback, 1);
  return () => clearTimeout(handle);
}
