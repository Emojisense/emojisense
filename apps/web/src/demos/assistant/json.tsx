import type { ReactNode } from "react";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** JSON with keys, strings and literals in their own spans. Punctuation stays plain text. */
export function highlightJson(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of json.matchAll(TOKEN)) {
    const start = match.index;
    if (start > last) nodes.push(json.slice(last, start));
    const [token, quoted, colon] = match;
    if (quoted !== undefined) {
      nodes.push(
        <span key={start} className={colon ? "assistant-json-key" : "assistant-json-string"}>
          {quoted}
        </span>,
      );
      if (colon) nodes.push(colon);
    } else {
      nodes.push(
        <span key={start} className="assistant-json-literal">
          {token}
        </span>,
      );
    }
    last = start + token.length;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return nodes;
}

/** `{ "query": "dark mode", "limit": 6 }`: one line, with the spacing people write by hand. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value, null, 1).replace(/\n\s*/g, " ");
}
