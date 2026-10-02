import { Marked, type Token, type Tokens } from "marked";

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface RenderedMarkdown {
  /** Text of the first level-1 heading. It is removed from `html`, so the page can own its H1. */
  title: string | undefined;
  html: string;
  /** Level-2 headings, for an "On this page" list. */
  headings: Heading[];
}

export interface RenderOptions {
  /** Rewrite link targets, e.g. "PACK_FORMAT.md" → "/docs/pack-format/". */
  resolveLink?: (href: string) => string;
}

/** Markdown inline syntax that should not show up in ids or in the table of contents. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

/**
 * Render one of the repository's docs (docs/*.md) for the website. The docs are our own,
 * trusted source files, so the HTML is not sanitized.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderedMarkdown {
  const ids = new WeakMap<Tokens.Heading, string>();
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        const id = ids.get(token);
        return id
          ? `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`
          : `<h${token.depth}>${inner}</h${token.depth}>\n`;
      },
    },
  });

  const tokens = marked.lexer(source);
  const titleIndex = tokens.findIndex((t) => t.type === "heading" && (t as Tokens.Heading).depth === 1);
  const title = titleIndex >= 0 ? plainText((tokens[titleIndex] as Tokens.Heading).text) : undefined;
  if (titleIndex >= 0) tokens.splice(titleIndex, 1);

  marked.walkTokens(tokens, (token: Token) => {
    if (token.type === "link" && options.resolveLink) {
      const link = token as Tokens.Link;
      link.href = options.resolveLink(link.href);
    }
    if (token.type === "heading") {
      const heading = token as Tokens.Heading;
      const text = plainText(heading.text);
      const base = slugify(text) || "section";
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      ids.set(heading, id);
      if (heading.depth === 2) headings.push({ depth: 2, id, text });
    }
  });

  const html = marked
    .parser(tokens)
    // Wide tables scroll inside their own box instead of widening the page on phones.
    .replaceAll("<table>", '<div class="table-scroll" tabindex="0"><table>')
    .replaceAll("</table>", "</table></div>");
  return { title, html, headings };
}

/**
 * Link rewriting for files in docs/: other docs that have a page on the site go there; any
 * other relative path goes to the file in the repository.
 */
export function docsLinkResolver(routes: Record<string, string>, repoUrl: string) {
  return (href: string): string => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
    const resolved = new URL(href, "https://repo.invalid/docs/");
    const path = resolved.pathname.slice(1);
    const route = routes[path];
    if (route) return `${route}${resolved.hash}`;
    return `${repoUrl}/blob/main/${path}${resolved.hash}`;
  };
}
