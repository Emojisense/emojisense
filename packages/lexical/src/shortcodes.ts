import { $getSelection, $isRangeSelection, type LexicalEditor, TextNode } from "lexical";
import { SHORTCODE_BEFORE_CARET } from "./source.js";

/**
 * Replace `:name:` with its emoji when the closing colon is typed. A node transform is Lexical's
 * documented way to rewrite text as it changes; this one only acts on the text right before a
 * collapsed caret, so colons elsewhere in the document stay as they are.
 */
export function registerShortcodeTransform(
  editor: LexicalEditor,
  resolveEmoji: (code: string) => string | undefined,
): () => void {
  return editor.registerNodeTransform(TextNode, (node) => {
    if (!node.isSimpleText()) return;
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.key !== node.getKey()) {
      return;
    }
    const caret = selection.anchor.offset;
    const match = SHORTCODE_BEFORE_CARET.exec(node.getTextContent().slice(0, caret));
    const emoji = match?.[1] ? resolveEmoji(match[1]) : undefined;
    if (!match || emoji === undefined) return;
    node.spliceText(caret - match[0].length, match[0].length, emoji, true);
  });
}
