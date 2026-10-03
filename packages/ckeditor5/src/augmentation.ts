import type { EmojisenseConfig, EmojisenseMention } from "./mention.js";

declare module "@ckeditor/ckeditor5-core" {
  interface EditorConfig {
    /** Emojisense `:` autocomplete. */
    emojisense?: EmojisenseConfig;
  }

  interface PluginsMap {
    [EmojisenseMention.pluginName]: EmojisenseMention;
  }
}
