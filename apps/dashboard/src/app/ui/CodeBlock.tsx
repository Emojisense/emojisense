import type { ReactNode } from "react";
import { CopyButton } from "./Copy";

type Lang = "js" | "sh";

interface CodeBlockProps {
  code: string;
  lang?: Lang;
  /** A value to mark inside the code, e.g. the API key. */
  mark?: string;
  label: string;
}

/** Group 1 = a comment, group 2 = a string. */
const PATTERNS: Record<Lang, RegExp> = {
  js: /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
  sh: /(^#[^\n]*|\s#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^'\n]*')/gm,
};

/** Wraps each occurrence of `mark` in `text`, which starts at `offset` in the code (the React key). */
function withMark(text: string, offset: number, mark: string | undefined): ReactNode[] {
  if (!mark || !text.includes(mark)) return [text];
  const nodes: ReactNode[] = [];
  let from = 0;
  for (let at = text.indexOf(mark); at !== -1; at = text.indexOf(mark, from)) {
    nodes.push(
      text.slice(from, at),
      <span key={offset + at} className="tok-key">
        {mark}
      </span>,
    );
    from = at + mark.length;
  }
  nodes.push(text.slice(from));
  return nodes;
}

/** Monochrome highlighting: comments recede, strings soften, nothing else changes color. */
function highlight(code: string, lang: Lang, mark?: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(PATTERNS[lang])) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(...withMark(code.slice(last, index), last, mark));
    const [token, comment] = match;
    nodes.push(
      <span key={`t${index}`} className={comment ? "tok-comment" : "tok-string"}>
        {comment ? token : withMark(token, index, mark)}
      </span>,
    );
    last = index + token.length;
  }
  if (last < code.length) nodes.push(...withMark(code.slice(last), last, mark));
  return nodes;
}

export function CodeBlock({ code, lang = "js", mark, label }: CodeBlockProps) {
  return (
    <figure className="code">
      <figcaption className="visually-hidden">{label}</figcaption>
      <pre>
        <code>{highlight(code, lang, mark)}</code>
      </pre>
      <div className="code-copy">
        <CopyButton value={code} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </figure>
  );
}
