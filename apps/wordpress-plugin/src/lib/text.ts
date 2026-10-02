export interface Caret {
  start: number;
  end: number;
}

/**
 * Inserts text at a saved caret of a text field (replacing a selection), puts the caret after it,
 * focuses the field and fires `input`, so scripts that watch the field see the change.
 *
 * @returns The caret after the inserted text.
 */
export function insertAtCaret(
  field: HTMLTextAreaElement | HTMLInputElement,
  text: string,
  caret: Caret,
): Caret {
  const length = field.value.length;
  const start = Math.min(Math.max(0, caret.start), length);
  const end = Math.min(Math.max(start, caret.end), length);
  field.focus();
  field.setRangeText(text, start, end, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  const after = start + text.length;
  return { start: after, end: after };
}
