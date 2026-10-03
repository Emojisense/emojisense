/** A viewport rectangle (`getBoundingClientRect` coordinates). */
export interface CaretRect {
  top: number;
  left: number;
  bottom: number;
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
 * The caret's line in a textarea or input, measured with an invisible mirror that wraps text the
 * same way. In a tall comment box this keeps the menu next to the line being typed. Falls back to
 * the field's bottom-left corner when the field has no layout.
 */
export function caretRect(field: HTMLTextAreaElement | HTMLInputElement): CaretRect {
  const doc = field.ownerDocument;
  const view = doc.defaultView;
  const box = field.getBoundingClientRect();
  const fallback = { top: box.top, left: box.left, bottom: box.bottom };
  if (!view || (box.width === 0 && box.height === 0)) return fallback;

  const style = view.getComputedStyle(field);
  const mirror = doc.createElement("div");
  for (const property of MIRRORED_STYLES) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    overflow: "hidden",
    whiteSpace: field instanceof view.HTMLInputElement ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
  });
  const caret = field.selectionEnd ?? field.value.length;
  mirror.textContent = field.value.slice(0, caret);
  const marker = doc.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  doc.body.append(mirror);
  try {
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.25 || 16;
    const top = box.top + (Number.parseFloat(style.borderTopWidth) || 0) + marker.offsetTop - field.scrollTop;
    const left =
      box.left + (Number.parseFloat(style.borderLeftWidth) || 0) + marker.offsetLeft - field.scrollLeft;
    // A caret scrolled out of view still anchors to the visible part of the field.
    const clampedTop = Math.min(Math.max(top, box.top), Math.max(box.top, box.bottom - lineHeight));
    const clampedLeft = Math.min(Math.max(left, box.left), box.right);
    return { top: clampedTop, left: clampedLeft, bottom: clampedTop + lineHeight };
  } finally {
    mirror.remove();
  }
}
