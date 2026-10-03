/**
 * The Tiptap editor of the Docs demo. Loaded with a dynamic import, so the page chrome paints
 * before ProseMirror is parsed.
 */
import { EmojiAutocomplete } from "@emojisense/tiptap";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { AliasEngine, SemanticProvider } from "emojisense";
import type { DemoMessages } from "../../i18n/demos";
import type { DocCopy } from "./content";
import { createDocMenu, type DocMenuController } from "./menu";
import { Callout, TaskItem, TaskList } from "./nodes";
import { Presence, type PresenceState, presenceKey } from "./presence";

export { finishScript, playScript } from "./autoplay";

export interface DocEditorOptions {
  element: HTMLElement;
  /** The document in the page's language. */
  copy: DocCopy;
  /** The editor's own words (placeholder, menu, checkboxes) in the page's language. */
  words: DemoMessages["doc"];
  /** Engine locale of the page: ranks the `:` menu and names its rows. */
  locale: string;
  /** The visitor's languages: only their phrases match. */
  locales: readonly string[];
  engine: () => AliasEngine | undefined;
  semantic: () => SemanticProvider | undefined;
  /** Show the "type :" hint on the last line from the start. */
  hint: boolean;
  /** Initial HTML. */
  content: string;
  /** A pointer pressed the `:` menu (it is mounted outside the demo). */
  onMenuPointerDown: () => void;
}

export interface DocEditor {
  editor: Editor;
  copy: DocCopy;
  engine: () => AliasEngine | undefined;
  menu: DocMenuController;
  setPresence(state: Partial<PresenceState>): void;
  destroy(): void;
}

export function createDocEditor(options: DocEditorOptions): DocEditor {
  const { words, locale } = options;
  const menu = createDocMenu(options.engine, options.onMenuPointerDown, words.menu, locale);
  const editor = new Editor({
    element: options.element,
    content: options.content,
    // The Content-Security-Policy blocks the <style> tag Tiptap injects; doc.css has those rules.
    injectCSS: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, link: false }),
      TaskList,
      TaskItem.configure({ done: words.done, notDone: words.notDone }),
      Callout,
      Presence.configure({ placeholder: words.placeholder, hint: options.hint }),
      // Above the list keymaps, so Enter in a list item inserts the emoji instead of splitting it.
      EmojiAutocomplete.extend({ priority: 1000 }).configure({
        engine: options.engine,
        semantic: options.semantic,
        locale,
        locales: options.locales,
        limit: 6,
        render: menu.render,
      }),
    ],
    editorProps: {
      attributes: { class: "doc-prose", "aria-label": words.bodyLabel, spellcheck: "false" },
    },
  });

  return {
    editor,
    copy: options.copy,
    engine: options.engine,
    menu: menu.controller,
    setPresence(state) {
      if (editor.isDestroyed) return;
      const { view } = editor;
      view.dispatch(view.state.tr.setMeta(presenceKey, state).setMeta("addToHistory", false));
    },
    destroy: () => editor.destroy(),
  };
}
