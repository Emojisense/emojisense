import { readConfig } from "../lib/config.js";
import { openPickerPopover, type PickerPopover } from "../shared/popover.js";
import "./classic.scss";

/** The parts of the TinyMCE 4 API (bundled with WordPress) that the plugin uses. */
interface TinyMceButton {
  getEl(): HTMLElement;
  active(state: boolean): void;
}

interface TinyMceEditor {
  addButton(name: string, settings: Record<string, unknown>): void;
  insertContent(html: string): void;
  focus(): void;
  on(event: string, callback: () => void): void;
  selection: {
    getBookmark(type?: number, normalized?: boolean): unknown;
    moveToBookmark(bookmark: unknown): void;
  };
}

declare const tinymce: {
  PluginManager: { add(name: string, factory: (editor: TinyMceEditor) => void): void };
};

/** The smiley of the block editor button, as an image for TinyMCE. */
const ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1e1e1e" d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10S2 17.52 2 12Zm6.5-1.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm4.5 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0ZM8.1 14.2a.75.75 0 0 1 1.04.2 3.4 3.4 0 0 0 5.72 0 .75.75 0 1 1 1.24.84 4.9 4.9 0 0 1-8.2 0 .75.75 0 0 1 .2-1.04Z"/></svg>',
)}`;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );

// A function, not an arrow function: TinyMCE calls the plugin with `new`.
tinymce.PluginManager.add("emojisense", function emojisensePlugin(editor) {
  const config = readConfig();
  const strings = config.strings ?? {};
  let popover: PickerPopover | undefined;

  editor.addButton("emojisense", {
    tooltip: strings.button ?? "Insert emoji",
    image: ICON,
    onclick(this: TinyMceButton) {
      if (popover) {
        popover.close(true);
        return;
      }
      const button = this;
      // Focus moves to the picker; the bookmark brings the caret back for the insert.
      const bookmark = editor.selection.getBookmark(2, true);
      button.active(true);
      popover = openPickerPopover({
        anchor: button.getEl(),
        config,
        label: strings.dialog ?? "Emoji picker",
        placeholder: strings.placeholder ?? "Search emoji…",
        onSelect(emoji) {
          editor.focus();
          editor.selection.moveToBookmark(bookmark);
          editor.insertContent(escapeHtml(emoji));
        },
        onClose(restoreFocus) {
          popover = undefined;
          button.active(false);
          if (restoreFocus) {
            editor.focus();
            editor.selection.moveToBookmark(bookmark);
          }
        },
      });
    },
  });

  editor.on("remove", () => popover?.close(false));
});
