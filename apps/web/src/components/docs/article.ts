/**
 * Build-time helpers for docs HTML: heading ids and anchors, the "On this page" list, and the
 * code blocks inside rendered Markdown. All input is our own trusted HTML.
 */
import { slugify } from "../../lib/markdown";

export interface TocItem {
  depth: 2 | 3;
  id: string;
  text: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (entity) => ENTITIES[entity] ?? entity);
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const HEADING = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g;

/**
 * Give every h2 and h3 an id (kept when the author set one), make the heading a link to itself,
 * and collect the headings for the table of contents. Headings with data-toc="off" are skipped.
 */
export function prepareArticle(html: string): { html: string; toc: TocItem[] } {
  const used = new Set<string>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) if (match[1]) used.add(match[1]);
  const toc: TocItem[] = [];

  const out = html.replace(HEADING, (whole, level: string, attrs = "", inner: string) => {
    const text = textOf(inner);
    // Card titles and similar headings opt out with data-toc="off".
    if (!text || attrs.includes('data-toc="off"')) return whole;
    let id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    if (!id) {
      const base = slugify(text) || "section";
      id = base;
      for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      attrs = ` id="${id}"${attrs}`;
    }
    toc.push({ depth: level === "2" ? 2 : 3, id, text });
    // A heading that already holds a link stays as it is: links cannot nest.
    const body = inner.includes("<a ") ? inner : `<a class="docs-heading-link" href="#${id}">${inner}</a>`;
    return `<h${level}${attrs}>${body}</h${level}>`;
  });
  return { html: out, toc };
}

export type HtmlSegment = { kind: "html"; html: string } | { kind: "code"; code: string; lang: string };

const CODE_BLOCK = /<pre><code(?: class="language-([\w+-]+)")?>([\s\S]*?)<\/code><\/pre>/g;

/**
 * Split rendered Markdown into plain HTML and code blocks, so each code block can be rendered by
 * CodeBlock.astro (highlighting, copy button). Concatenating the segments gives the input back.
 */
export function splitCodeBlocks(html: string): HtmlSegment[] {
  const segments: HtmlSegment[] = [];
  let last = 0;
  for (const match of html.matchAll(CODE_BLOCK)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "html", html: html.slice(last, start) });
    segments.push({
      kind: "code",
      lang: match[1] ?? "text",
      code: decodeEntities(match[2] ?? "").replace(/\n$/, ""),
    });
    last = start + match[0].length;
  }
  if (last < html.length) segments.push({ kind: "html", html: html.slice(last) });
  return segments;
}
