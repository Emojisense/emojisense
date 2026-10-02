/**
 * A small, monochrome syntax highlighter for the code panel: comments, strings, keywords and flags.
 * Enough to make a snippet easy to scan, without a highlighting library.
 */
export type TokenKind = "plain" | "comment" | "string" | "keyword" | "flag";

export interface Token {
  kind: TokenKind;
  text: string;
}

const JS =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|const|let|await|async|export|function|return|new|true|false|undefined)\b/g;
const SHELL = /((?:^|(?<=\s))#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^']*')|((?<=\s)--?[a-zA-Z][\w-]*)|\b(curl)\b/gm;

export function tokenize(code: string, language: "js" | "shell"): Token[] {
  const pattern = language === "js" ? JS : SHELL;
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "plain", text: code.slice(last, index) });
    const [text, comment, string, third] = match;
    const kind: TokenKind = comment
      ? "comment"
      : string
        ? "string"
        : language === "shell" && third
          ? "flag"
          : "keyword";
    tokens.push({ kind, text });
    last = index + text.length;
  }
  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });
  return tokens;
}
