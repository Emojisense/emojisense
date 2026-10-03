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
  /** Culture files of the pack version, e.g. "https://api.emojisense.com/v1/culture/0.1.0". */
  cultureUrl?: string;
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
  #source: SuggestionSource | undefined;
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
    this.#loadEngine();
  }

  override destroy(): void {
    this.#source?.dispose();
    this.#source = undefined;
    super.destroy();
  }

  #locale(): string {
    const language = this.editor.locale.contentLanguage ?? "";
    return this.#config.locale || language.split(/[-_]/)[0]?.toLowerCase() || "en";
  }

  #loadEngine() {
    const { engine, packUrl, cultureUrl } = this.#config;
    if (engine) return this.#useEngine(engine);
    if (!packUrl) {
      logWarning("emojisense-no-packs", {
        hint: "Set config.emojisense.packUrl or config.emojisense.engine.",
      });
      return;
    }
    const loader = createEngineLoader({ packUrl, locale: this.#locale(), cultureUrl });
    loader.subscribe((next) => {
      if (this.editor.state !== "destroyed") this.#useEngine(next);
    });
    loader.load().catch((error: unknown) => {
      logWarning("emojisense-packs-failed", { error });
    });
  }

  #useEngine(engine: AliasEngine) {
    const { semantic, endpoint, publishableKey, limit } = this.#config;
    this.#source?.dispose();
    this.#source = createSuggestionSource({
      engine,
      semantic:
        semantic ?? createApiSemantic({ endpoint, key: publishableKey, packVersion: engine.packVersion }),
      locale: this.#locale(),
      limit: limit ?? DEFAULT_LIMIT,
      minQueryLength: 2,
      includeCustom: false,
      region: "device",
    });
  }

  async #feed(query: string): Promise<EmojiMentionItem[]> {
    // Mention matches the rest of the line after ":", so a sentence ends the search.
    if (!this.#source || !findTrigger(`${TRIGGER}${query}`)) return [];
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
