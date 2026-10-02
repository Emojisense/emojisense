/**
 * Google Docs and Slides (the "kix" editor) draw text on a canvas. Keystrokes go to a hidden,
 * same-origin iframe with this class, and Docs' own scripts apply them to the document model.
 * Findings and options: GOOGLE_DOCS_SPIKE.md.
 */
export const DOCS_EVENT_FRAME_CLASS = "docs-texteventtarget-iframe";

export function isDocsEventFrame(element: Element | null | undefined): element is HTMLIFrameElement {
  return element?.localName === "iframe" && element.classList.contains(DOCS_EVENT_FRAME_CLASS);
}

/** True inside the hidden event iframe itself. The top frame owns the picker on Docs pages. */
export function isInsideDocsEventFrame(win: Window): boolean {
  try {
    return isDocsEventFrame(win.frameElement);
  } catch {
    return false;
  }
}

function docsEventTarget(frame: HTMLIFrameElement): HTMLElement | null {
  try {
    const doc = frame.contentDocument;
    if (!doc) return null;
    return doc.querySelector<HTMLElement>('[contenteditable="true"]') ?? doc.body;
  } catch {
    return null;
  }
}

/** Give the keyboard back to the document, so that ⌘V lands at the caret. */
export function focusDocsEditor(frame: HTMLIFrameElement): void {
  try {
    frame.contentWindow?.focus();
  } catch {
    // A cross-origin frame cannot be focused from here; the target below may still work.
  }
  docsEventTarget(frame)?.focus({ preventScroll: true });
}

/** The caret is still a DOM element in canvas mode, so it can anchor the picker. */
export function docsCaretRect(doc: Document): DOMRect | null {
  const caret = doc.querySelector(".kix-cursor-caret") ?? doc.querySelector(".kix-cursor");
  const rect = caret?.getBoundingClientRect();
  return rect && rect.height > 0 ? rect : null;
}

/**
 * Experimental, off by default: hand the text to Docs as a paste event. Docs handles paste itself
 * and cancels the browser default, so `defaultPrevented` tells whether its handler took the text.
 * Not verified against a signed-in document (see GOOGLE_DOCS_SPIKE.md). The caller copies the text
 * to the clipboard first, so a silent failure still leaves ⌘V as the way out.
 */
export function pasteIntoDocs(frame: HTMLIFrameElement, text: string): boolean {
  const target = docsEventTarget(frame);
  if (!target) return false;
  try {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    const event = new ClipboardEvent("paste", {
      clipboardData,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  } catch {
    return false;
  }
}
