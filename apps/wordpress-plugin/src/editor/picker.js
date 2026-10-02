import "@emojisense/web-component";
import { useEffect, useRef } from "@wordpress/element";
import { pickerAttributes } from "../lib/config";

/**
 * <emojisense-picker> in React. Attributes and the `emoji-select` listener go through a ref, which
 * works the same with every React version WordPress ships.
 *
 * @param {Object}                                   props
 * @param {import("../lib/config").ClientConfig}     props.config
 * @param {string}                                   props.placeholder Input placeholder and name.
 * @param {(emoji: string) => void}                  props.onSelect
 * @param {() => void}                               [props.onEscape]  Escape on an empty search.
 * @param {boolean}                                  [props.autoFocus]
 */
export function EmojiPicker({ config, placeholder, onSelect, onEscape, autoFocus = true }) {
  const ref = useRef(null);
  const handlers = useRef({ onSelect, onEscape });
  handlers.current = { onSelect, onEscape };

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    // Not a className prop: React before 19 sets custom elements' attributes by their prop names.
    element.classList.add("emojisense-picker");
    for (const [name, value] of Object.entries(pickerAttributes(config, placeholder))) {
      element.setAttribute(name, value);
    }
    const select = (event) => handlers.current.onSelect(event.detail.emoji);
    const keydown = (event) => {
      // The picker clears the query on the first Escape and lets the next one through.
      if (event.key === "Escape" && !event.defaultPrevented && handlers.current.onEscape) {
        event.stopPropagation();
        handlers.current.onEscape();
      }
    };
    element.addEventListener("emoji-select", select);
    element.addEventListener("keydown", keydown);
    if (autoFocus) requestAnimationFrame(() => element.focus());
    return () => {
      element.removeEventListener("emoji-select", select);
      element.removeEventListener("keydown", keydown);
    };
  }, [config, placeholder, autoFocus]);

  return <emojisense-picker ref={ref} columns="8" />;
}
