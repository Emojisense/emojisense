import "@emojisense/web-component";
import { type ClientConfig, pickerAttributes } from "../lib/config.js";

export interface PickerPopoverOptions {
  /** The button that opened the picker; the popover sits below it (or above, without room). */
  anchor: HTMLElement;
  config: ClientConfig;
  /** Accessible name of the dialog. */
  label: string;
  placeholder: string;
  onSelect: (emoji: string) => void;
  /** After every close; `restoreFocus` is true when focus should go back to the anchor. */
  onClose?: (restoreFocus: boolean) => void;
}

export interface PickerPopover {
  readonly element: HTMLElement;
  close(restoreFocus?: boolean): void;
}

const GAP = 6;
const EDGE = 8;
const COLOR = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)/;

/** Whether the first mostly opaque background behind an element is dark. */
export function isOnDarkBackground(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let node: Element | null = element; node && view; node = node.parentElement) {
    const match = COLOR.exec(view.getComputedStyle(node).backgroundColor);
    if (!match) continue;
    const alphaText = match[4];
    const alpha =
      alphaText === undefined
        ? 1
        : alphaText.endsWith("%")
          ? Number.parseFloat(alphaText) / 100
          : Number(alphaText);
    if (alpha < 0.5) continue;
    const [r, g, b] = [match[1], match[2], match[3]].map((value) => Number(value) / 255) as [
      number,
      number,
      number,
    ];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
  }
  return false;
}

/**
 * A light dialog with <emojisense-picker>, for pages without the block editor's components (the
 * classic editor and the comment form). Escape (on an empty search), a click outside and a choice
 * close it.
 */
export function openPickerPopover(options: PickerPopoverOptions): PickerPopover {
  const { anchor, config, label, placeholder, onSelect, onClose } = options;
  const doc = anchor.ownerDocument;
  const view = doc.defaultView ?? window;

  const element = doc.createElement("div");
  element.className = isOnDarkBackground(anchor) ? "emojisense-popover is-dark" : "emojisense-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", label);

  const picker = doc.createElement("emojisense-picker");
  picker.className = "emojisense-picker";
  picker.setAttribute("columns", "8");
  for (const [name, value] of Object.entries(pickerAttributes(config, placeholder))) {
    picker.setAttribute(name, value);
  }
  element.append(picker);
  doc.body.append(element);

  let closed = false;
  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", onPointerDown, true);
    view.removeEventListener("resize", place);
    element.remove();
    onClose?.(restoreFocus);
  };
  const onPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    if (target && !element.contains(target) && !anchor.contains(target)) close(false);
  };
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const roomBelow = view.innerHeight - rect.bottom;
    const top =
      roomBelow >= height + GAP || rect.top < height + GAP ? rect.bottom + GAP : rect.top - height - GAP;
    const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, view.innerWidth - width - EDGE));
    element.style.top = `${top + view.scrollY}px`;
    element.style.left = `${left + view.scrollX}px`;
  };

  picker.addEventListener("emoji-select", (event) => {
    onSelect((event as CustomEvent<{ emoji: string }>).detail.emoji);
    close(false);
  });
  element.addEventListener("keydown", (event) => {
    // The picker stops the first Escape (it clears the search); the next one closes.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  doc.addEventListener("pointerdown", onPointerDown, true);
  view.addEventListener("resize", place);
  place();
  view.requestAnimationFrame(() => {
    place();
    (picker as HTMLElement).focus();
  });

  return { element, close };
}
