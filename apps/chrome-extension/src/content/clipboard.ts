/**
 * Copy text to the clipboard from a content script.
 *
 * First a synchronous copy command that fills the copy event ourselves: it needs no selection, and
 * the `clipboardWrite` permission lets it run even after the keypress's user activation has been
 * used. Then the async Clipboard API, which a frame's permissions policy can block.
 */
export async function copyText(doc: Document, text: string): Promise<boolean> {
  if (copyWithCommand(doc, text)) return true;
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyWithCommand(doc: Document, text: string): boolean {
  const view = doc.defaultView;
  if (!view || typeof doc.execCommand !== "function") return false;
  let filled = false;
  const fill = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    // Some sites rewrite copied text ("Read more at …"); keep their listeners out of this copy.
    event.stopImmediatePropagation();
    filled = true;
  };
  view.addEventListener("copy", fill, true);
  try {
    doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    view.removeEventListener("copy", fill, true);
  }
  return filled;
}
