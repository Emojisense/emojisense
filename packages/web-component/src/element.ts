import {
  type AliasEngine,
  applySkinTone,
  type Culture,
  type CultureResult,
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  deviceRegion,
  EMOJI_IMAGE_REFERRER_POLICY,
  type EmojiEntry,
  type EmojiSet,
  emojiImageUrl,
  groupLabel,
  isAutoRegion,
  isEmojiSet,
  loadCulture,
  loadCustomPack,
  loadPacks,
  localDay,
  type Pack,
  relevantNow,
  type SearchSession,
  type SessionState,
  type SessionStatus,
  SKIN_TONES,
  type SkinTone,
} from "emojisense";
import { type GridLayout, isGridKey, layoutRows, moveActive } from "./grid.js";
import { styles } from "./styles.js";

export interface EmojiSelectDetail {
  /** The emoji with the picker's skin tone applied; `:shortcode:` for a custom emoji. */
  emoji: string;
  /** Label in the picker's locale. */
  label: string;
  /** Emojibase hexcode of the base emoji, stable across skin tones (e.g. "1F44D"); `C-<id>` for custom. */
  id: string;
  /** Custom emoji only: the image to insert or show. */
  imageUrl?: string;
  /** Custom emoji only: the shortcode without colons. */
  shortcode?: string;
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
  /** Custom emoji: drawn from this image, whatever the emoji set. */
  imageUrl?: string | undefined;
  shortcode?: string | undefined;
  /** Why a culture result or a "relevant now" emoji is there, in the culture file's locale. */
  context?: string;
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
const RELEVANT_NOW_LABEL = "Relevant now";
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
  "emojiSet",
  "placeholder",
  "packs",
  "customEmoji",
  "tenant",
  "cultureUrl",
  "region",
  "showRelevantNow",
  "culture",
] as const;

// Importing this module during server rendering must not throw.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<emojisense-picker>`: an emoji picker with Emojisense search. With an empty query it shows
 * every emoji by category. While typing it shows the ranked results: on-device alias results on
 * every keystroke, then shard or API results fused in when the dictionary is unsure.
 *
 * Attributes: `pack-url`, `shards-url`, `endpoint`, `key` (alias `publishable-key`), `locale`,
 * `columns`, `skin-tone`, `emoji-set`, `placeholder`, `custom-emoji` (load the key's custom
 * emoji from `endpoint`), `tenant`, `culture-url`, `region` and `show-relevant-now`. Custom emoji
 * are drawn as images. Event: `emoji-select` with `{ emoji, label, id }`, plus `imageUrl` and
 * `shortcode` for a custom emoji.
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
    "emoji-set",
    "placeholder",
    "custom-emoji",
    "tenant",
    "culture-url",
    "region",
    "show-relevant-now",
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
  /** The locale packs in the engine; the custom pack is added on top. */
  #basePacks: Pack[] | undefined;
  #customPack: Pack | undefined;
  #customKey: string | undefined;
  #customLoading: AbortController | undefined;
  #engine: AliasEngine | undefined;
  #session: SearchSession | undefined;
  #packKey: unknown;
  #sessionKey: string | undefined;
  #loading: AbortController | undefined;
  #cancelIdle: (() => void) | undefined;
  #scheduled = false;
  /** Set as a property, it wins over `culture-url`. */
  #cultureOverride: Culture | undefined;
  #culture: Culture | undefined;
  #cultureKey: unknown;
  #cultureLoading: AbortController | undefined;
  /** What the browse view's "relevant now" row was drawn for. */
  #shelfKey = "";

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
    // The "relevant now" row follows the device's day: a picker left open overnight draws the new
    // day's row when it gets focus again.
    this.#input.addEventListener("focus", () => {
      if (this.#engine && this.#currentShelfKey() !== this.#shelfKey) this.#refreshBrowse();
    });
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

  /**
   * `native` (default) draws the system font. `twemoji`, `noto` and `fluent` draw images hosted
   * at `{endpoint}/v1/sets/{set}/{hexcode}.svg`, so they need `endpoint` and a `key` whose plan
   * includes hosted sets.
   */
  get emojiSet(): EmojiSet {
    const set = this.getAttribute("emoji-set");
    return isEmojiSet(set) ? set : "native";
  }
  set emojiSet(value: EmojiSet) {
    this.setAttribute("emoji-set", value);
  }

  get placeholder(): string {
    return this.getAttribute("placeholder") || DEFAULT_PLACEHOLDER;
  }
  set placeholder(value: string) {
    this.setAttribute("placeholder", value);
  }

  /** `custom-emoji`: load the custom emoji of `key` from `endpoint` (GET /v1/custom-pack). */
  get customEmoji(): boolean {
    return this.hasAttribute("custom-emoji");
  }
  set customEmoji(value: boolean) {
    this.toggleAttribute("custom-emoji", Boolean(value));
  }

  /** The app owner's id for one of their customers: adds that tenant's custom emoji. */
  get tenant(): string {
    return this.getAttribute("tenant") ?? "";
  }
  set tenant(value: string) {
    this.setAttribute("tenant", value);
  }

  /**
   * Culture files directory, e.g. "https://api.emojisense.com/v1/culture/0.1.0". Culture results
   * join after the top result; without it the ranking is the canonical one.
   */
  get cultureUrl(): string {
    return this.getAttribute("culture-url") ?? "";
  }
  set cultureUrl(value: string) {
    this.setAttribute("culture-url", value);
  }

  /**
   * ISO 3166-1 alpha-2 region (e.g. "BR") for regional culture entries. Without the attribute,
   * the picker uses the region of the browser's language (`navigator.language` "pt-BR" → "BR"),
   * on the device only. `region=""` turns regional entries off. `region="auto"` asks the API for
   * the region of the request's country (needs `endpoint`); search results use it after the
   * first API answer, and the relevant-now row shows entries for every region only.
   */
  get region(): string {
    return this.getAttribute("region") ?? "";
  }
  set region(value: string) {
    this.setAttribute("region", value);
  }

  /** Show a "relevant now" row above the browse view (needs culture). Off by default. */
  get showRelevantNow(): boolean {
    return this.hasAttribute("show-relevant-now");
  }
  set showRelevantNow(value: boolean) {
    this.toggleAttribute("show-relevant-now", value);
  }

  /** A culture file to use instead of fetching `culture-url` (bundled or offline apps). */
  get culture(): Culture | undefined {
    return this.#culture;
  }
  set culture(value: Culture | undefined) {
    this.#cultureOverride = value;
    this.#schedule();
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
    if (this.#cultureLoading) this.#cultureKey = undefined;
    this.#cultureLoading?.abort();
    this.#loading?.abort();
    this.#cancelIdle?.();
    if (this.#customLoading) {
      // Reconnecting starts the custom pack request again.
      this.#customLoading.abort();
      this.#customLoading = undefined;
      this.#customKey = undefined;
    }
    this.#session?.dispose();
    this.#session = undefined;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === "columns") {
      this.#applyColumns();
      this.#schedule(); // the "relevant now" row holds one row of emoji
    } else if (name === "skin-tone") this.#redrawGlyphs((item) => item.hasSkinTones);
    else if (name === "emoji-set") this.#redrawGlyphs(() => true);
    else if (name === "placeholder") this.#applyPlaceholder();
    else {
      if (name === "endpoint" || name === "key" || name === "publishable-key") this.#redrawGlyphs(() => true);
      this.#schedule();
    }
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
    this.#configureCustomEmoji();
    this.#configureCulture();
    const packKey = this.#packs ?? `${this.packUrl}\n${this.locale}`;
    if (packKey !== this.#packKey) {
      this.#packKey = packKey;
      if (this.#packs) this.#usePacks(this.#packs, true);
      else if (this.packUrl) void this.#load(this.packUrl, this.locale);
      else this.#reset();
      return;
    }
    this.#connectSession();
    if (this.#engine && this.#currentShelfKey() !== this.#shelfKey) this.#refreshBrowse();
  }

  /** Load the culture file when `culture-url` or `locale` change. It is optional: errors are ignored. */
  #configureCulture() {
    const key = this.#cultureOverride ?? (this.cultureUrl ? `${this.cultureUrl}\n${this.locale}` : "");
    if (key === this.#cultureKey) return;
    this.#cultureKey = key;
    this.#cultureLoading?.abort();
    this.#cultureLoading = undefined;
    if (this.#cultureOverride || !this.cultureUrl) {
      this.#useCulture(this.#cultureOverride);
      return;
    }
    const controller = new AbortController();
    this.#cultureLoading = controller;
    loadCulture({ baseUrl: this.cultureUrl, locale: this.locale, signal: controller.signal }).then(
      (culture) => {
        if (controller.signal.aborted) return;
        this.#cultureLoading = undefined;
        this.#useCulture(culture);
      },
      () => {
        // The culture layer only adds results; search works the same without it.
        if (!controller.signal.aborted) this.#useCulture(undefined);
      },
    );
  }

  #useCulture(culture: Culture | undefined) {
    this.#culture = culture;
    if (!this.#engine) return;
    this.#engine = this.#engine.withCulture(culture);
    this.#sessionKey = undefined;
    this.#connectSession();
    if (this.#currentShelfKey() !== this.#shelfKey) this.#refreshBrowse();
  }

  #currentShelfKey(): string {
    if (!this.showRelevantNow || !this.#culture) return "";
    const { locale, from } = this.#culture;
    return [locale, from, localDay(), this.#region(), this.columns].join("|");
  }

  /**
   * The `region` attribute, else the region of the browser's language. A region code is never
   * sent anywhere; "auto" is sent to the API, which answers with the caller's region.
   */
  #region(): string | undefined {
    const region = this.getAttribute("region");
    return region === null ? deviceRegion() : region || undefined;
  }

  /** Redraw the browse view and keep showing the results of a query being typed. */
  #refreshBrowse() {
    this.#renderBrowse();
    this.#search(this.#input.value);
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
    this.#basePacks = packs;
    this.#engine = createEngine(
      this.#customPack ? [...packs, this.#customPack] : packs,
      this.#culture ? { culture: this.#culture } : {},
    );
    this.#status = "ready";
    if (renderBrowse) this.#renderBrowse();
    this.#sessionKey = undefined;
    this.#connectSession();
  }

  /**
   * Loads the key's custom emoji when `custom-emoji`, `endpoint` and `key` are set, and adds
   * them to the engine and the browse view when they arrive. They are optional: a failed
   * request leaves the catalog as it is.
   */
  #configureCustomEmoji() {
    const enabled = this.customEmoji && this.endpoint !== "" && this.publishableKey !== "";
    const key = enabled ? [this.endpoint, this.publishableKey, this.tenant].join("\n") : "";
    if (key === this.#customKey) return;
    this.#customKey = key;
    this.#customLoading?.abort();
    this.#customLoading = undefined;
    const use = (pack: Pack | undefined) => {
      this.#customPack = pack;
      if (this.#basePacks) this.#usePacks(this.#basePacks, true);
    };
    if (!enabled) {
      if (this.#customPack) use(undefined);
      return;
    }
    const controller = new AbortController();
    this.#customLoading = controller;
    loadCustomPack({
      endpoint: this.endpoint,
      key: this.publishableKey,
      ...(this.tenant ? { tenant: this.tenant } : {}),
      signal: controller.signal,
    }).then(
      (pack) => {
        if (controller.signal.aborted) return;
        this.#customLoading = undefined;
        use(pack);
      },
      () => {
        if (this.#customLoading === controller) this.#customLoading = undefined;
      },
    );
  }

  #reset() {
    this.#loading?.abort();
    this.#basePacks = undefined;
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
    const region = this.#region();
    const key = [this.shardsUrl, this.endpoint, this.publishableKey, this.locale, region].join("\n");
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
      ...(region ? { region } : {}),
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
    const addGroup = (title: string, part = "group") => {
      const labelId = `group-${groupSizes.length}`;
      const section = element("div", { class: "group", part, role: "group" });
      section.setAttribute("aria-labelledby", labelId);
      // aria-hidden: the label names the group; read inside the listbox it would be noise.
      const label = element("div", { class: "group-label", part: "group-label", id: labelId });
      label.setAttribute("aria-hidden", "true");
      label.textContent = title;
      const grid = element("div", { class: "grid" });
      section.append(label, grid);
      fragment.append(section);
      groupSizes.push(0);
      return grid;
    };
    const addItem = (grid: HTMLElement, item: Item) => {
      items.push(item);
      groupSizes[groupSizes.length - 1] = (groupSizes.at(-1) ?? 0) + 1;
      grid.append(this.#option("b", items.length - 1, item));
    };

    // Optional "relevant now" row: featured seasonal and event emoji, one row at most.
    this.#shelfKey = this.#currentShelfKey();
    if (this.#shelfKey && this.#culture) {
      // With "auto", only a search learns the region; the row shows entries for every region.
      const region = isAutoRegion(this.#region()) ? undefined : this.#region();
      const shelf = relevantNow(this.#culture, {
        limit: this.columns,
        ...(region ? { region } : {}),
      }).flatMap(({ hexcode, context }) => {
        const entry = engine.get(hexcode);
        return entry ? [{ ...this.#itemOf(entry), context }] : [];
      });
      if (shelf.length > 0) {
        const grid = addGroup(RELEVANT_NOW_LABEL, "group relevant-now");
        for (const item of shelf) addItem(grid, item);
      }
    }

    let grid: HTMLElement | undefined;
    let group: string | undefined;
    for (const entry of engine.entries) {
      if (!grid || entry.group !== group) {
        group = entry.group;
        grid = addGroup(groupLabel(group, this.locale));
      }
      addItem(grid, this.#itemOf(entry));
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
      const items = state.results.map((result): Item => {
        const entry = engine?.get(result.id);
        const item = entry ? this.#itemOf(entry) : { ...result, label: result.emoji, hasSkinTones: false };
        return result.source === "culture" ? { ...item, context: (result as CultureResult).context } : item;
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
      imageUrl: entry.imageUrl,
      shortcode: entry.shortcode,
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
    option.title = item.context ? `${item.label} · ${item.context}` : item.label;
    if (item.context) option.setAttribute("aria-description", item.context);
    option.dataset.index = String(index);
    this.#drawGlyph(option, item);
    return option;
  }

  #glyph(item: Item): string {
    return item.hasSkinTones ? applySkinTone(item.emoji, this.skinTone) : item.emoji;
  }

  /**
   * The emoji as text, or as `<img src alt loading="lazy">`: a custom emoji's image (alt
   * `:shortcode:`) or the hosted set's. A set may not draw every emoji (Fluent has no country
   * flags), so a failed image gives way to the text.
   */
  #drawGlyph(option: HTMLElement, item: Item) {
    const emoji = this.#glyph(item);
    const src =
      item.imageUrl ??
      emojiImageUrl(emoji, {
        emojiSet: this.emojiSet,
        endpoint: this.endpoint,
        key: this.publishableKey || undefined,
      });
    if (!src) {
      option.textContent = emoji;
      return;
    }
    const image = element("img", { src, alt: emoji, loading: "lazy", decoding: "async", part: "image" });
    image.setAttribute("draggable", "false");
    // The API checks a set image's key against the page's origin, sent as the Referer.
    if (!item.imageUrl) image.setAttribute("referrerpolicy", EMOJI_IMAGE_REFERRER_POLICY);
    image.addEventListener("error", () => image.replaceWith(emoji), { once: true });
    option.replaceChildren(image);
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
    const detail: EmojiSelectDetail = {
      emoji: this.#glyph(item),
      label: item.label,
      id: item.id,
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      ...(item.shortcode ? { shortcode: item.shortcode } : {}),
    };
    this.dispatchEvent(new CustomEvent("emoji-select", { detail, bubbles: true, composed: true }));
  }

  #applyColumns() {
    this.#root.style.setProperty("--columns", String(this.columns));
    for (const view of [this.#browse, this.#results]) view.layout = layoutRows(view.groupSizes, this.columns);
  }

  #redrawGlyphs(affects: (item: Item) => boolean) {
    for (const view of [this.#browse, this.#results]) {
      view.items.forEach((item, index) => {
        const option = view.options[index];
        if (option && affects(item)) this.#drawGlyph(option, item);
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
