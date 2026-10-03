import { findTrigger, TRIGGER } from "emojisense/autocomplete";

/**
 * The `onKeyUp` of Discourse's emoji autocomplete for the queries its own pattern misses: words
 * with spaces (`:ship it`) and letters outside ASCII (`:çay`). Returns `[":query"]` like the
 * original, so the autocomplete knows where the query starts.
 */
export function findEmojiQuery(text: string, caret: number, maxWords = 4): [string] | undefined {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const newline = text.indexOf("\n", caret);
  const lineEnd = newline === -1 ? text.length : newline;
  const match = findTrigger(text.slice(lineStart, caret), text.slice(caret, lineEnd), { maxWords });
  return match && match.query.trim() !== "" ? [`${TRIGGER}${match.query}`] : undefined;
}
