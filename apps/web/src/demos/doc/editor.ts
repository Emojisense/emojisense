/**
 * The Tiptap editor of the Docs demo. Loaded with a dynamic import, so the page chrome paints
 * before ProseMirror is parsed.
 */
import { EmojiAutocomplete } from "@emojisense/tiptap";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { AliasEngine, SemanticProvider } from "emojisense";
import { createDocMenu, type DocMenuController } from "./menu";
import { Callout, TaskItem, TaskList } from "./nodes";
import { Presence, type PresenceState, presenceKey } from "./presence";

export { finishScript, playScript } from "./autoplay";

export interface DocEditorOptions {
  element: HTMLElement;
  content: string;
  engine: () => AliasEngine | undefined;
  semantic: () => SemanticProvider | undefined;
  /** Show the "type :" hint on the last line from the start. */
  hint: boolean;
  /** A pointer pressed the `:` menu (it is mounted outside the demo). */
  onMenuPointerDown: () => void;
}

export interface DocEditor {
  editor: Editor;
  engine: () => AliasEngine | undefined;
  menu: DocMenuController;
  setPresence(state: Partial<PresenceState>): void;
  destroy(): void;
}

export function createDocEditor(options: DocEditorOptions): DocEditor {
  const menu = createDocMenu(options.engine, options.onMenuPointerDown);
  const editor = new Editor({
    element: options.element,
    content: options.content,
    // The Content-Security-Policy blocks the <style> tag Tiptap injects; doc.css has those rules.
    injectCSS: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, link: false }),
      TaskList,
      TaskItem,
      Callout,
      Presence.configure({ placeholder: "Type “:” and a word for emoji…", hint: options.hint }),
      // Above the list keymaps, so Enter in a list item inserts the emoji instead of splitting it.
      EmojiAutocomplete.extend({ priority: 1000 }).configure({
        engine: options.engine,
        semantic: options.semantic,
        locale: "en",
        limit: 6,
        render: menu.render,
      }),
    ],
    editorProps: {
      attributes: { class: "doc-prose", "aria-label": "Document body", spellcheck: "false" },
    },
  });

  return {
    editor,
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
