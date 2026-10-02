import { docsCaretRect, isDocsEventFrame } from "./docs";

/**
 * Where the emoji goes, captured when the picker opens. Focus moves into the picker's search box,
 * so the caret position must be saved now and restored on insert or close.
 */
export type EditableTarget =
  | {
      kind: "text-control";
      element: HTMLInputElement | HTMLTextAreaElement;
      /** null when the input type has no selection API (e.g. email). */
      start: number | null;
      end: number | null;
    }
  | { kind: "contenteditable"; element: HTMLElement; range: Range | null }
  | { kind: "google-docs"; frame: HTMLIFrameElement }
  | { kind: "none"; element: HTMLElement | null };

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Input types that hold free text. Password fields are left out on purpose. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email"]);

/** document.activeElement, followed into open shadow roots (web components, editors). */
export function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export function captureTarget(doc: Document): EditableTarget {
  const active = deepActiveElement(doc);
  if (!active || active === doc.body || active === doc.documentElement)
    return { kind: "none", element: null };
  if (isDocsEventFrame(active)) return { kind: "google-docs", frame: active };
  if (isTextControl(active)) {
    if (active.disabled || active.readOnly) return { kind: "none", element: active };
    return { kind: "text-control", element: active, ...readSelection(active) };
  }
  if (isHTMLElement(active) && active.isContentEditable) {
    return { kind: "contenteditable", element: active, range: savedRange(active) };
  }
  return { kind: "none", element: isHTMLElement(active) ? active : null };
}

/** Tag checks instead of instanceof: elements from same-origin iframes come from another realm. */
function isTextControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element.localName === "textarea") return true;
  return element.localName === "input" && TEXT_INPUT_TYPES.has((element as HTMLInputElement).type);
}

function isHTMLElement(element: Element): element is HTMLElement {
  return "isContentEditable" in element;
}

export function readSelection(element: HTMLInputElement | HTMLTextAreaElement): {
  start: number | null;
  end: number | null;
} {
  try {
    return { start: element.selectionStart, end: element.selectionEnd };
  } catch {
    return { start: null, end: null };
  }
}

function savedRange(element: HTMLElement): Range | null {
  // Inside a shadow tree, Chrome reports the real selection only through the shadow root.
  const root = element.getRootNode() as unknown as { getSelection?: () => Selection | null };
  const selection = root.getSelection?.() ?? element.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

/** Viewport rectangle the picker should sit next to: the caret when known, else the field. */
export function targetRect(target: EditableTarget): Rect | null {
  switch (target.kind) {
    case "text-control":
      return (
        (target.element.localName === "textarea"
          ? textareaCaretRect(target.element as HTMLTextAreaElement)
          : null) ?? elementRect(target.element)
      );
    case "contenteditable":
      return rangeRect(target.range) ?? elementRect(target.element);
    case "google-docs":
      return docsCaretRect(target.frame.ownerDocument);
    case "none":
      return target.element ? elementRect(target.element) : null;
  }
}

function hasArea(rect: DOMRect | undefined): rect is DOMRect {
  return rect !== undefined && (rect.width > 0 || rect.height > 0);
}

function elementRect(element: Element): Rect | null {
  const rect = element.getBoundingClientRect();
  return hasArea(rect) ? rect : null;
}

function rangeRect(range: Range | null): Rect | null {
  if (!range) return null;
  const first = range.getClientRects()[0];
  if (hasArea(first)) return first;
  const box = range.getBoundingClientRect();
  return hasArea(box) ? box : null;
}

/** Styles that change where text wraps; copied to the measuring mirror. */
const MIRRORED_STYLES = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

/**
 * Caret position in a textarea, measured with an invisible mirror that wraps text the same way.
 * In a tall comment box this keeps the picker next to the line being typed, not under the box.
 */
function textareaCaretRect(textarea: HTMLTextAreaElement): Rect | null {
  const doc = textarea.ownerDocument;
  const view = doc.defaultView;
  const field = textarea.getBoundingClientRect();
  if (!view || !doc.body || !hasArea(field)) return null;

  const style = view.getComputedStyle(textarea);
  const mirror = doc.createElement("div");
  for (const property of MIRRORED_STYLES) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  const caret = textarea.selectionEnd ?? textarea.value.length;
  mirror.textContent = textarea.value.slice(0, caret);
  const marker = doc.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  doc.body.append(mirror);
  try {
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.25;
    const top = field.top + Number.parseFloat(style.borderTopWidth) + marker.offsetTop - textarea.scrollTop;
    const left =
      field.left + Number.parseFloat(style.borderLeftWidth) + marker.offsetLeft - textarea.scrollLeft;
    // A caret scrolled out of view still anchors to the visible part of the field.
    const clampedTop = Math.min(Math.max(top, field.top), field.bottom - lineHeight);
    const clampedLeft = Math.min(Math.max(left, field.left), field.right);
    return { top: clampedTop, left: clampedLeft, bottom: clampedTop + lineHeight, right: clampedLeft + 1 };
  } finally {
    mirror.remove();
  }
}
