import type { EditableTarget } from "./target";

/**
 * How the text got in, in the order the strategies are tried:
 * - `beforeinput`: the page's editor cancelled our beforeinput and inserted the text itself
 *   (Lexical, Slate and similar model-first editors).
 * - `execCommand`: native editing. Keeps the undo stack and fires trusted input events, so React,
 *   Vue, ProseMirror and CodeMirror see the change as if typed.
 * - `setRangeText` / `range`: direct DOM edit plus a synthetic input event, when native editing is
 *   unavailable (e.g. inside some frames, or in tests).
 * - `append`: input types without a selection API (email); the text goes at the end.
 */
export type InsertStrategy = "beforeinput" | "execCommand" | "setRangeText" | "range" | "append";

export type InsertResult =
  | { ok: true; strategy: InsertStrategy }
  | { ok: false; reason: "unsupported" | "detached" | "read-only" };

export function insertText(target: EditableTarget, text: string): InsertResult {
  switch (target.kind) {
    case "text-control":
      return insertIntoTextControl(target, text);
    case "contenteditable":
      return insertIntoContentEditable(target, text);
    default:
      return { ok: false, reason: "unsupported" };
  }
}

/** Put focus and caret back where they were when the picker opened. */
export function restoreTarget(target: EditableTarget): void {
  switch (target.kind) {
    case "text-control": {
      const { element, start, end } = target;
      if (!element.isConnected) return;
      element.focus({ preventScroll: true });
      if (start !== null && end !== null) trySetSelection(element, start, end);
      return;
    }
    case "contenteditable": {
      if (!target.element.isConnected) return;
      target.element.focus({ preventScroll: true });
      if (target.range) selectRange(target.element, target.range);
      return;
    }
    default:
      return;
  }
}

function insertIntoTextControl(
  target: Extract<EditableTarget, { kind: "text-control" }>,
  text: string,
): InsertResult {
  const { element } = target;
  if (!element.isConnected) return { ok: false, reason: "detached" };
  if (element.disabled || element.readOnly) return { ok: false, reason: "read-only" };

  restoreTarget(target);
  const hasCaret = target.start !== null && target.end !== null;
  if (!announceBeforeInput(element, text, null)) return { ok: true, strategy: "beforeinput" };

  const before = element.value;
  if (runInsertTextCommand(element.ownerDocument, text) && element.value !== before) {
    return { ok: true, strategy: "execCommand" };
  }

  if (hasCaret) {
    const start = Math.min(target.start as number, before.length);
    const end = Math.min(target.end as number, before.length);
    element.setRangeText(text, start, end);
    // Set explicitly rather than via selectMode "end": not every engine applies that mode.
    trySetSelection(element, start + text.length, start + text.length);
  } else {
    element.value = before + text;
  }
  announceInput(element, text);
  return { ok: true, strategy: hasCaret ? "setRangeText" : "append" };
}

function insertIntoContentEditable(
  target: Extract<EditableTarget, { kind: "contenteditable" }>,
  text: string,
): InsertResult {
  const { element } = target;
  if (!element.isConnected) return { ok: false, reason: "detached" };

  restoreTarget(target);
  const range = currentRange(element) ?? endOfContent(element);
  if (!announceBeforeInput(element, text, range)) return { ok: true, strategy: "beforeinput" };

  const before = element.textContent;
  if (runInsertTextCommand(element.ownerDocument, text) && element.textContent !== before) {
    return { ok: true, strategy: "execCommand" };
  }

  range.deleteContents();
  const node = element.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selectRange(element, range);
  announceInput(element, text);
  return { ok: true, strategy: "range" };
}

/**
 * Dispatch a cancelable beforeinput like a keystroke would. Returns false when the page cancelled
 * it, which model-first editors do when they apply the text themselves.
 */
function announceBeforeInput(element: HTMLElement, text: string, range: Range | null): boolean {
  const init: InputEventInit = {
    inputType: "insertText",
    data: text,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  if (range && typeof StaticRange === "function") {
    init.targetRanges = [
      new StaticRange({
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
      }),
    ];
  }
  return element.dispatchEvent(new InputEvent("beforeinput", init));
}

function announceInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(
    new InputEvent("input", { inputType: "insertText", data: text, bubbles: true, composed: true }),
  );
}

/**
 * execCommand is deprecated, but it is still the only way to edit as the user would: the browser
 * fires trusted input events and records an undo step. Chrome fires no beforeinput for it, so the
 * one we dispatched above is not duplicated.
 */
function runInsertTextCommand(doc: Document, text: string): boolean {
  try {
    return typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text);
  } catch {
    return false;
  }
}

function trySetSelection(element: HTMLInputElement | HTMLTextAreaElement, start: number, end: number): void {
  try {
    element.setSelectionRange(start, end);
  } catch {
    // Input types without a selection API throw here; the caret stays where focus put it.
  }
}

function selectionFor(element: HTMLElement): Selection | null {
  const root = element.getRootNode() as unknown as { getSelection?: () => Selection | null };
  return root.getSelection?.() ?? element.ownerDocument.getSelection();
}

function selectRange(element: HTMLElement, range: Range): void {
  const selection = selectionFor(element);
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function currentRange(element: HTMLElement): Range | null {
  const selection = selectionFor(element);
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer) ? range : null;
}

function endOfContent(element: HTMLElement): Range {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selectRange(element, range);
  return range;
}
