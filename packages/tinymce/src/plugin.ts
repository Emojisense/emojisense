import type { AliasEngine, SemanticProvider, SkinTone } from "emojisense";
import {
  createApiSemantic,
  createEngineLoader,
  createSuggestionSource,
  DEFAULT_LIMIT,
  type SuggestionSource,
} from "emojisense/autocomplete";
import type { Editor, TinyMCE } from "tinymce";
import { createAutocompleter, escapeHtml } from "./autocompleter.js";

export const PLUGIN_NAME = "emojisense";
const DOCS_URL = "https://emojisense.com/docs/integrations/tinymce/";

/**
 * The editor options of the plugin (`tinymce.init({ emojisense_pack_url: … })`). Set
 * `emojisense_pack_url` or `emojisense_engine`; everything else is optional.
 */
export interface EmojisenseEditorOptions {
  /** Base URL of a pack version, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  emojisense_pack_url?: string;
  /** A ready engine instead of `emojisense_pack_url`. */
  emojisense_engine?: AliasEngine;
  /** Pack locale. Default: the editor's `language` ("tr_TR" → "tr"), else English. */
  emojisense_locale?: string;
  /**
   * All the user's languages, e.g. `userLocales()` → ["tr", "en"], or a string: "tr en". Only
   * their packs load, and search matches only their phrases (English always counts). Default:
   * `emojisense_locale` and English.
   */
  emojisense_locales?: readonly string[] | string;
  /**
   * Culture files of the pack version, e.g. "https://api.emojisense.com/v1/culture/0.1.0".
   * Default: the culture directory next to `emojisense_pack_url`. `"off"`: no culture layer.
   */
  emojisense_culture_url?: string;
  /**
   * Region for regional culture entries. Default `"device"`: the device's region (its language,
   * else its time zone). `""`: none. `"auto"`: the API's view of the caller's country.
   */
  emojisense_region?: string;
  /** The Emojisense API, for search by meaning when the dictionary is unsure. Off without it. */
  emojisense_endpoint?: string;
  /** Publishable key (`pk_…`) for the API. Never a secret key: this runs in the browser. */
  emojisense_publishable_key?: string;
  /** A semantic provider instead of `emojisense_endpoint`. */
  emojisense_semantic?: SemanticProvider;
  /** "light", "medium-light", "medium", "medium-dark" or "dark". */
  emojisense_skin_tone?: SkinTone | "";
  /** Menu size. Default 8. */
  emojisense_limit?: number;
  /** Take over the `:` menu of the emoticons plugin when it is loaded. Default true. */
  emojisense_replace_emoticons?: boolean;
}

/** `["tr", "en"]`, `"tr en"` or `"tr,en"` → ["tr", "en"], like TinyMCE's own list options. */
function localesProcessor(
  value: unknown,
): { valid: true; value: string[] } | { valid: false; message: string } {
  if (typeof value === "string") return { valid: true, value: value.split(/[\s,]+/).filter(Boolean) };
  if (Array.isArray(value) && value.every((locale) => typeof locale === "string")) {
    return { valid: true, value: [...value] };
  }
  return { valid: false, message: 'emojisense_locales must be a list of locales, e.g. ["tr", "en"].' };
}

/** `""` = the culture directory next to the packs (the loader's default), `"off"` = none. */
const cultureUrlOption = (value = ""): string | false | undefined =>
  value.toLowerCase() === "off" ? false : value || undefined;

/** Register the `emojisense` plugin with this TinyMCE (7 or 8). */
export function registerEmojisense(tinymce: TinyMCE): void {
  tinymce.PluginManager.add(PLUGIN_NAME, (editor) => {
    setUp(editor);
    return { getMetadata: () => ({ name: "Emojisense", url: DOCS_URL }) };
  });
}

function registerOptions(editor: Editor) {
  const register = editor.options.register;
  register("emojisense_pack_url", { processor: "string", default: "" });
  register("emojisense_engine", { processor: "object" });
  register("emojisense_locale", { processor: "string", default: "" });
  register("emojisense_locales", { processor: localesProcessor, default: [] });
  register("emojisense_culture_url", { processor: "string", default: "" });
  register("emojisense_region", { processor: "string", default: "device" });
  register("emojisense_endpoint", { processor: "string", default: "" });
  register("emojisense_publishable_key", { processor: "string", default: "" });
  register("emojisense_semantic", { processor: "object" });
  register("emojisense_skin_tone", { processor: "string", default: "" });
  register("emojisense_limit", { processor: "number", default: DEFAULT_LIMIT });
  register("emojisense_replace_emoticons", { processor: "boolean", default: true });
}

function option<K extends keyof EmojisenseEditorOptions>(
  editor: Editor,
  name: K,
): EmojisenseEditorOptions[K] {
  return editor.options.get(name) as EmojisenseEditorOptions[K];
}

function editorLocale(editor: Editor): string {
  const language = String(editor.options.get("language") ?? "");
  return option(editor, "emojisense_locale") || language.split(/[-_]/)[0]?.toLowerCase() || "en";
}

/** The user's languages; undefined without them, so search matches every loaded pack. */
function editorLocales(editor: Editor): string[] | undefined {
  const locales = editor.options.get<string[]>("emojisense_locales");
  return locales?.length ? locales : undefined;
}

function setUp(editor: Editor) {
  registerOptions(editor);
  const locale = editorLocale(editor);
  const locales = editorLocales(editor);
  const limit = option(editor, "emojisense_limit") ?? DEFAULT_LIMIT;
  const packUrl = option(editor, "emojisense_pack_url");
  let engine: AliasEngine | undefined;
  let source: SuggestionSource | undefined;
  /** Kept across engines (core, then the extension packs), so loaded shards stay loaded. */
  let semantic: { packVersion: string; provider: SemanticProvider | undefined } | undefined;
  /** Settles when the first engine is in use, or the packs failed. */
  let ready: Promise<void> | undefined;
  let stopLoader: (() => void) | undefined;

  const semanticFor = (packVersion: string): SemanticProvider | undefined => {
    const given = option(editor, "emojisense_semantic");
    if (given) return given;
    if (semantic?.packVersion !== packVersion) {
      semantic = {
        packVersion,
        provider: createApiSemantic({
          endpoint: option(editor, "emojisense_endpoint"),
          key: option(editor, "emojisense_publishable_key"),
          packVersion,
        }),
      };
    }
    return semantic.provider;
  };

  const useEngine = (next: AliasEngine) => {
    if (next === engine || editor.removed) return;
    source?.dispose();
    engine = next;
    source = createSuggestionSource({
      engine: next,
      semantic: semanticFor(next.packVersion),
      locale,
      locales,
      limit,
      minQueryLength: 2,
      includeCustom: false,
      region: option(editor, "emojisense_region"),
    });
    // A menu that opened while the packs loaded shows its results now.
    if (editor.queryCommandState("mceAutoCompleterInRange")) editor.execCommand("mceAutocompleterReload");
  };

  /** Loads the packs once. A failed load is tried again on the next focus or `:`. */
  const loadEngine = (): Promise<void> => {
    ready ??= (async () => {
      if (!packUrl) return;
      // Editors with the same packs on one page share one download and one index.
      const loader = createEngineLoader({
        packUrl,
        locale,
        locales,
        cultureUrl: cultureUrlOption(option(editor, "emojisense_culture_url")),
      });
      stopLoader?.();
      stopLoader = loader.subscribe(useEngine);
      try {
        useEngine(await loader.load());
      } catch (error) {
        ready = undefined;
        console.warn("emojisense: the packs did not load; the : menu stays off.", error);
      }
    })();
    return ready;
  };

  editor.on("init", () => {
    const takeOver =
      option(editor, "emojisense_replace_emoticons") !== false && editor.hasPlugin("emoticons");
    editor.ui.registry.addAutocompleter(
      // The registry is keyed by name: the same name replaces the emoticons plugin's menu, which
      // would otherwise merge its substring matches into this one.
      takeOver ? "emoticons" : PLUGIN_NAME,
      createAutocompleter({
        source: () => {
          if (!engine) void loadEngine();
          return engine ? source : undefined;
        },
        skinTone: () => option(editor, "emojisense_skin_tone") || undefined,
        limit,
        insert: (range, emoji) => {
          editor.selection.setRng(range);
          editor.insertContent(escapeHtml(emoji));
        },
      }),
    );
    const given = option(editor, "emojisense_engine");
    if (given) return useEngine(given);
    if (!packUrl) {
      console.warn("emojisense: set emojisense_pack_url or emojisense_engine. See", DOCS_URL);
      return;
    }
    // The packs load when someone starts writing, not with the page.
    editor.on("focus", () => void loadEngine());
    if (editor.hasFocus()) void loadEngine();
  });

  editor.on("remove", () => {
    stopLoader?.();
    source?.dispose();
    source = undefined;
  });
}
