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
  /** Culture files of the pack version, e.g. "https://api.emojisense.com/v1/culture/0.1.0". */
  emojisense_culture_url?: string;
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
  register("emojisense_culture_url", { processor: "string", default: "" });
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

function setUp(editor: Editor) {
  registerOptions(editor);
  const locale = editorLocale(editor);
  const limit = option(editor, "emojisense_limit") ?? DEFAULT_LIMIT;
  let engine: AliasEngine | undefined;
  let source: SuggestionSource | undefined;

  const useEngine = (next: AliasEngine) => {
    source?.dispose();
    engine = next;
    const semantic =
      option(editor, "emojisense_semantic") ??
      createApiSemantic({
        endpoint: option(editor, "emojisense_endpoint"),
        key: option(editor, "emojisense_publishable_key"),
        packVersion: next.packVersion,
      });
    source = createSuggestionSource({
      engine: next,
      semantic,
      locale,
      limit,
      minQueryLength: 2,
      includeCustom: false,
      region: "device",
    });
    // A menu that opened while the packs loaded shows its results now.
    if (editor.queryCommandState("mceAutoCompleterInRange")) editor.execCommand("mceAutocompleterReload");
  };

  const loadEngine = () => {
    const given = option(editor, "emojisense_engine");
    if (given) return useEngine(given);
    const packUrl = option(editor, "emojisense_pack_url");
    if (!packUrl) {
      console.warn("emojisense: set emojisense_pack_url or emojisense_engine. See", DOCS_URL);
      return;
    }
    const loader = createEngineLoader({
      packUrl,
      locale,
      cultureUrl: option(editor, "emojisense_culture_url") || undefined,
    });
    loader.subscribe((next) => {
      if (!editor.removed) useEngine(next);
    });
    loader.load().catch((error: unknown) => {
      console.warn("emojisense: the packs did not load; the : menu stays off.", error);
    });
  };

  editor.on("init", () => {
    const takeOver =
      option(editor, "emojisense_replace_emoticons") !== false && editor.hasPlugin("emoticons");
    editor.ui.registry.addAutocompleter(
      // The registry is keyed by name: the same name replaces the emoticons plugin's menu, which
      // would otherwise merge its substring matches into this one.
      takeOver ? "emoticons" : PLUGIN_NAME,
      createAutocompleter({
        source: () => (engine ? source : undefined),
        skinTone: () => option(editor, "emojisense_skin_tone") || undefined,
        limit,
        insert: (range, emoji) => {
          editor.selection.setRng(range);
          editor.insertContent(escapeHtml(emoji));
        },
      }),
    );
    loadEngine();
  });

  editor.on("remove", () => {
    source?.dispose();
    source = undefined;
  });
}
