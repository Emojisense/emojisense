import {
  type Editor,
  logWarning,
  Mention,
  type MentionFeed,
  type MentionFeedObjectItem,
  type ModelRange,
  Plugin,
} from "ckeditor5";
import { type AliasEngine, applySkinTone, type SemanticProvider, type SkinTone } from "emojisense";
import {
  createApiSemantic,
  createEngineLoader,
  createSuggestionSource,
  DEFAULT_LIMIT,
  type EmojiSuggestion,
  findTrigger,
  type SuggestionSource,
  TRIGGER,
} from "emojisense/autocomplete";

/** `config.emojisense`. Set `packUrl` or `engine`; everything else is optional. */
export interface EmojisenseConfig {
  /** Base URL of a pack version, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  packUrl?: string;
  /** A ready engine instead of `packUrl`. */
  engine?: AliasEngine;
  /** Pack locale. Default: the editor's content language ("pt-br" → "pt"). English always loads. */
  locale?: string;
  /**
   * Culture files of the pack version, e.g. "https://api.emojisense.com/v1/culture/0.1.0".
   * Default: the culture directory next to `packUrl`. `false`: no culture layer.
   */
  cultureUrl?: string | false;
  /**
   * Region for regional culture entries. Default: the device's region (its language, else its
   * time zone). `""`: none. `"auto"`: the API's view of the caller's country (needs `endpoint`).
   */
  region?: string;
  /** The Emojisense API, for search by meaning when the dictionary is unsure. Off without it. */
  endpoint?: string;
  /** Publishable key (`pk_…`). Never a secret key: this runs in the browser. */
  publishableKey?: string;
  /** A semantic provider instead of `endpoint`. */
  semantic?: SemanticProvider;
  skinTone?: SkinTone;
  /** Menu size. Default 8. */
  limit?: number;
}

/** A mention feed item: `text` is the emoji that replaces `:query`. */
export interface EmojiMentionItem extends MentionFeedObjectItem {
  text: string;
  label: string;
  context?: string;
}

interface MentionExecuteData {
  marker: string;
  mention: { text?: string };
  range: ModelRange;
}

/**
 * `:` emoji autocomplete on the Mention plugin. Queries may contain spaces (`:ship it`), and the
 * chosen emoji is inserted as plain text, not as a mention.
 */
export class EmojisenseMention extends Plugin {
  static get pluginName() {
    return "EmojisenseMention" as const;
  }

  static get requires() {
    return [Mention] as const;
  }

  #config: EmojisenseConfig;
  #engine: AliasEngine | undefined;
  #source: SuggestionSource | undefined;
  /** Kept across engines (core, then the extension packs), so loaded shards stay loaded. */
  #semantic: { packVersion: string; provider: SemanticProvider | undefined } | undefined;
  /** Settles when the first engine is in use, or the packs failed. */
  #ready: Promise<void> | undefined;
  #stopLoader: (() => void) | undefined;
  #feedAdded = false;

  constructor(editor: Editor) {
    super(editor);
    this.#config = (editor.config.get("emojisense") as EmojisenseConfig | undefined) ?? {};
    // Mention reads its feeds in its init(), after every plugin's constructor.
    const feeds = (editor.config.get("mention.feeds") as MentionFeed[] | undefined) ?? [];
    if (feeds.some((feed) => feed.marker === TRIGGER)) {
      // EmojiMention (or the app) owns ":"; Mention allows one feed per marker.
      logWarning("emojisense-marker-conflict", { marker: TRIGGER });
      return;
    }
    editor.config.set("mention.feeds", [
      ...feeds,
      {
        marker: TRIGGER,
        // ":)" and ":D" stay emoticons.
        minimumCharacters: 2,
        dropdownLimit: this.#config.limit ?? DEFAULT_LIMIT,
        feed: (query: string) => this.#feed(query),
        itemRenderer: (item) => renderItem(item as EmojiMentionItem),
      },
    ]);
    this.#feedAdded = true;
  }

  init(): void {
    if (!this.#feedAdded) return;
    const { editor } = this;
    editor.commands.get("mention")?.on(
      "execute",
      (event, args) => {
        const data = (args as unknown[])[0] as MentionExecuteData;
        if (data.marker !== TRIGGER || !data.mention.text) return;
        event.stop();
        editor.execute("insertText", { text: data.mention.text, range: data.range });
      },
      { priority: "high" },
    );
    if (this.#config.engine) {
      this.#useEngine(this.#config.engine);
      return;
    }
    // The packs load when someone starts writing, not with the page.
    const viewDocument = editor.editing.view.document;
    if (viewDocument.isFocused) void this.#load();
    else {
      this.listenTo(viewDocument, "change:isFocused", (event, _name, focused) => {
        if (!focused) return;
        event.off();
        void this.#load();
      });
    }
  }

  override destroy(): void {
    this.#stopLoader?.();
    this.#source?.dispose();
    this.#source = undefined;
    super.destroy();
  }

  #locale(): string {
    const language = this.editor.locale.contentLanguage ?? "";
    return this.#config.locale || language.split(/[-_]/)[0]?.toLowerCase() || "en";
  }

  /** Loads the packs once. A failed load is tried again on the next `:`. */
  #load(): Promise<void> {
    this.#ready ??= this.#startLoading();
    return this.#ready;
  }

  async #startLoading(): Promise<void> {
    const { packUrl, cultureUrl } = this.#config;
    if (!packUrl) {
      logWarning("emojisense-no-packs", {
        hint: "Set config.emojisense.packUrl or config.emojisense.engine.",
      });
      return;
    }
    // Editors with the same packs on one page share one download and one index.
    const loader = createEngineLoader({ packUrl, locale: this.#locale(), cultureUrl });
    this.#stopLoader?.();
    this.#stopLoader = loader.subscribe((next) => this.#useEngine(next));
    try {
      this.#useEngine(await loader.load());
    } catch (error) {
      this.#ready = undefined;
      logWarning("emojisense-packs-failed", { error });
    }
  }

  #useEngine(engine: AliasEngine) {
    if (engine === this.#engine || this.editor.state === "destroyed") return;
    const { semantic, endpoint, publishableKey, limit, region = "device" } = this.#config;
    const { packVersion } = engine;
    if (!semantic && this.#semantic?.packVersion !== packVersion) {
      this.#semantic = {
        packVersion,
        provider: createApiSemantic({ endpoint, key: publishableKey, packVersion }),
      };
    }
    this.#engine = engine;
    this.#source?.dispose();
    this.#source = createSuggestionSource({
      engine,
      semantic: semantic ?? this.#semantic?.provider,
      locale: this.#locale(),
      limit: limit ?? DEFAULT_LIMIT,
      minQueryLength: 2,
      includeCustom: false,
      region,
    });
  }

  async #feed(query: string): Promise<EmojiMentionItem[]> {
    // Mention matches the rest of the line after ":", so a sentence ends the search.
    if (!findTrigger(`${TRIGGER}${query}`)) return [];
    // A ":" typed before the packs arrived gets its list as soon as they do.
    if (!this.#source) await this.#load();
    if (!this.#source) return [];
    const suggestions = await this.#source.resolve(query);
    return suggestions.map((suggestion) => toItem(suggestion, this.#config.skinTone));
  }
}

function toItem(suggestion: EmojiSuggestion, tone: SkinTone | undefined): EmojiMentionItem {
  return {
    // Mention ids must start with the marker and be unique in the list.
    id: `${TRIGGER}${suggestion.id}`,
    text: tone ? applySkinTone(suggestion.emoji, tone) : suggestion.emoji,
    label: suggestion.label,
    ...(suggestion.context ? { context: suggestion.context } : {}),
  };
}

/** A list button like the official emoji feature's, so editor themes style it. */
function renderItem(item: EmojiMentionItem): HTMLElement {
  const button = document.createElement("button");
  button.className = "ck ck-button ck-button_with-text emojisense-mention-item";
  button.type = "button";
  button.tabIndex = -1;
  button.id = `mention-list-item-id${item.id.replace(/[^\w-]/g, "-")}`;
  const label = document.createElement("span");
  label.className = "ck ck-button__label";
  label.textContent = item.context
    ? `${item.text} ${item.label} · ${item.context}`
    : `${item.text} ${item.label}`;
  button.append(label);
  return button;
}
