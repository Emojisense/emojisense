import { EmojisensePickerElement } from "./element.js";

export {
  type EmojiSelectDetail,
  type EmojiSelectEvent,
  EmojisensePickerElement,
  type PickerStatus,
} from "./element.js";

declare global {
  interface HTMLElementTagNameMap {
    "emojisense-picker": EmojisensePickerElement;
  }
}

/**
 * Register the element. Importing this package calls it once with the default tag; call it
 * again for another tag name. Safe to call twice and during server rendering.
 */
export function defineEmojisensePicker(tagName = "emojisense-picker"): void {
  if (typeof customElements === "undefined" || customElements.get(tagName)) return;
  // A constructor can back only one tag name, so other names get a subclass.
  const elementClass =
    tagName === "emojisense-picker" ? EmojisensePickerElement : class extends EmojisensePickerElement {};
  customElements.define(tagName, elementClass);
}

defineEmojisensePicker();
