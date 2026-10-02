import api from "../../../../docs/API.md?raw";
import packFormat from "../../../../docs/PACK_FORMAT.md?raw";
import { REPO_URL } from "../config";
import { docsLinkResolver, renderMarkdown } from "../lib/markdown";

export interface DocPage {
  href: string;
  title: string;
  description: string;
}

export const DOC_PAGES: DocPage[] = [
  {
    href: "/docs/",
    title: "Quickstart",
    description: "Add Emojisense to a React app, a Frimousse picker, plain JavaScript or any page.",
  },
  {
    href: "/docs/api/",
    title: "HTTP API",
    description: "Endpoints, keys, metering and status codes of the Emojisense search API.",
  },
  {
    href: "/docs/pack-format/",
    title: "Pack format",
    description: "The normative format of the data packs, vectors and shards, for ports to any language.",
  },
  {
    href: "/docs/self-host/",
    title: "Self-host",
    description: "Run the search API on your own Cloudflare account.",
  },
  {
    href: "/docs/privacy/",
    title: "Privacy",
    description: "What Emojisense stores, what it never stores, and why.",
  },
];

/** Repository files (relative to the repo root) that have their own page on the site. */
const ROUTES: Record<string, string> = {
  "docs/API.md": "/docs/api/",
  "docs/PACK_FORMAT.md": "/docs/pack-format/",
};

const resolveLink = docsLinkResolver(ROUTES, REPO_URL);

/** Rendered once per build. The source of truth stays in docs/*.md. */
export const API_DOC = renderMarkdown(api, { resolveLink });
export const PACK_FORMAT_DOC = renderMarkdown(packFormat, { resolveLink });

export function docPage(href: string): DocPage {
  const page = DOC_PAGES.find((p) => p.href === href);
  if (!page) throw new Error(`No docs page registered for ${href}`);
  return page;
}
