import { readConfig } from "../lib/config.js";
import { insertAtCaret } from "../lib/text.js";
import { openPickerPopover, type PickerPopover } from "../shared/popover.js";
import "./comments.scss";

/**
 * The "Emoji" button under the comment field (Emojisense_Comments::add_button). The picker loads
 * the packs from this site the first time it opens.
 */
function setUp(button: HTMLButtonElement) {
  const form = button.closest("form");
  const field = form?.querySelector<HTMLTextAreaElement>('textarea[name="comment"]');
  if (!field) return;
  const config = readConfig();
  const strings = config.strings ?? {};
  let popover: PickerPopover | undefined;
  let caret = { start: field.value.length, end: field.value.length };

  // Remember the caret: the field loses it when the picker takes focus.
  const remember = () => {
    caret = {
      start: field.selectionStart ?? field.value.length,
      end: field.selectionEnd ?? field.value.length,
    };
  };
  field.addEventListener("keyup", remember);
  field.addEventListener("pointerup", remember);
  field.addEventListener("blur", remember);

  button.hidden = false;
  button.addEventListener("click", () => {
    if (popover) {
      popover.close(true);
      return;
    }
    button.setAttribute("aria-expanded", "true");
    popover = openPickerPopover({
      anchor: button,
      config,
      label: strings.dialog ?? "Emoji picker",
      placeholder: strings.placeholder ?? "Search emoji…",
      onSelect(emoji) {
        caret = insertAtCaret(field, emoji, caret);
      },
      onClose(restoreFocus) {
        popover = undefined;
        button.setAttribute("aria-expanded", "false");
        if (restoreFocus) button.focus();
      },
    });
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".emojisense-comment-button")) {
  setUp(button);
}
