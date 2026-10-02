/**
 * The docs information architecture: every page under /docs/, in reading order. The sidebar,
 * breadcrumbs, prev/next links, sitemap entries and the build test all read this list.
 */
import type { PlanId } from "@emojisense/platform";

/**
 * - `planned`: designed in the product contract, not on `main` yet. The page says so.
 * - `next`: the routes are on `main` but not deployed: "Coming in this release".
 * - `experimental`: works today, the API can still change.
 */
export type DocsStatus = "planned" | "next" | "experimental";

export interface DocsPage {
  href: string;
  title: string;
  /** Shorter label for the sidebar, when the title is long. */
  navTitle?: string;
  description: string;
  /** Lowest plan that has the feature. Omit for features on every plan. */
  plan?: PlanId;
  status?: DocsStatus;
  /**
   * Strings that appear in the server source once the feature's routes exist (for example
   * "/v1/custom-pack"). The build test compares them with `status`, so a page cannot say
   * "planned" for a shipped route, or promise a route that is not on `main`.
   */
  routes?: string[];
  /** Repository file the page renders, for the "Edit this page" link. Defaults to the .astro file. */
  source?: string;
}

export interface DocsSection {
  id: string;
  title: string;
  pages: DocsPage[];
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: "get-started",
    title: "Get started",
    pages: [
      {
        href: "/docs/",
        title: "Introduction",
        description:
          "Emojisense is the complete emoji platform: search, reactions, photo to emoji, custom emoji and more, for every app and in every language.",
      },
      {
        href: "/docs/quickstart/",
        title: "Quickstart",
        description: "Get a key, install the SDK, search and ship a picker in about five minutes.",
      },
      {
        href: "/docs/concepts/",
        title: "Concepts",
        description:
          "How the on-device engine, edge meaning search, caching and plan limits work together, and what stays private.",
      },
    ],
  },
  {
    id: "guides",
    title: "Guides",
    pages: [
      {
        href: "/docs/guides/search/",
        title: "Search in your picker",
        navTitle: "Search",
        description: "Rank emoji by meaning as people type, in any picker, with results on every keystroke.",
      },
      {
        href: "/docs/guides/reactions/",
        title: "Reaction suggestions",
        navTitle: "Reactions",
        description: "Suggest the emoji people react with, from the text of a message.",
      },
      {
        href: "/docs/guides/photo-to-emoji/",
        title: "Photo to emoji",
        description: "Turn a photo into the emoji that fit it, without storing the image.",
      },
      {
        href: "/docs/guides/custom-emoji/",
        title: "Custom emoji",
        description:
          "Upload your own emoji, import them from Slack or Discord, and search them next to Unicode.",
        plan: "solo",
        routes: ["/v1/custom-pack", "/emoji/import/slack"],
      },
      {
        href: "/docs/guides/emoji-sets/",
        title: "Hosted emoji sets",
        description: "Show Twemoji, Noto or Fluent emoji from the edge, so every device looks the same.",
        plan: "solo",
        routes: ["/v1/sets/"],
      },
      {
        href: "/docs/guides/analytics/",
        title: "Analytics",
        description: "See what people search for, and which searches find nothing.",
        plan: "pro",
        routes: ["/api/apps/:id/analytics"],
      },
      {
        href: "/docs/guides/teams/",
        title: "Teams",
        description: "Invite people to your apps with owner, admin, developer and viewer roles.",
        plan: "pro",
        routes: ["/api/team"],
      },
      {
        href: "/docs/guides/tenants/",
        title: "Tenants",
        description: "Give each of your customers their own custom emoji set, from one app.",
        plan: "scale",
        routes: ["/v1/tenants"],
      },
      {
        href: "/docs/guides/webhooks/",
        title: "Webhooks",
        description: "Get signed events when custom emoji, tenants or usage change.",
        plan: "scale",
        routes: ["/api/apps/:id/webhooks"],
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    pages: [
      {
        href: "/docs/integrations/react/",
        title: "React and Frimousse",
        navTitle: "React + Frimousse",
        description: "Hooks for any React picker, a drop-in Frimousse picker and a shadcn/ui component.",
      },
      {
        href: "/docs/integrations/web-component/",
        title: "Web component",
        description: "<emojisense-picker> for Vue, Svelte, Angular and plain HTML.",
      },
      {
        href: "/docs/integrations/tiptap/",
        title: "Tiptap",
        description: "Type a colon in a Tiptap editor and get emoji ranked by meaning.",
      },
      {
        href: "/docs/integrations/lexical/",
        title: "Lexical",
        description: "Colon autocomplete for Lexical editors in React.",
      },
      {
        href: "/docs/integrations/emoji-mart/",
        title: "emoji-mart",
        description: "Keep emoji-mart and give it Emojisense ranking.",
      },
      {
        href: "/docs/integrations/swift/",
        title: "Swift",
        description: "The same engine for iOS and macOS, with the same results as TypeScript.",
      },
      {
        href: "/docs/integrations/mcp/",
        title: "MCP server",
        description: "Give AI assistants emoji search, emoji for a sentence and reaction suggestions.",
      },
      {
        href: "/docs/integrations/chrome/",
        title: "Chrome extension",
        description: "An emoji picker for any text field in Chrome, with search on the device.",
      },
      {
        href: "/docs/integrations/raycast/",
        title: "Raycast",
        description: "Search emoji by meaning from Raycast and paste them into any app.",
      },
      {
        href: "/docs/integrations/wordpress/",
        title: "WordPress",
        description:
          "Colon autocomplete in the block editor, post reactions and an emoji picker in comments.",
      },
      {
        href: "/docs/integrations/http/",
        title: "HTTP",
        description: "Call the API from any language or server with plain HTTP.",
      },
    ],
  },
  {
    id: "reference",
    title: "API reference",
    pages: [
      {
        href: "/docs/api/",
        title: "HTTP API",
        description: "Endpoints, keys, metering and status codes of the Emojisense API.",
        source: "docs/API.md",
      },
      {
        href: "/docs/sdk/",
        title: "JavaScript SDK",
        description:
          "Every export of the emojisense package: engine, loader, sessions, providers and fusion.",
      },
      {
        href: "/docs/pack-format/",
        title: "Pack format",
        description: "The normative format of the data packs, vectors and shards, for ports to any language.",
        source: "docs/PACK_FORMAT.md",
      },
    ],
  },
  {
    id: "platform",
    title: "Platform",
    pages: [
      {
        href: "/docs/keys-and-limits/",
        title: "Keys and limits",
        description:
          "Publishable and secret keys, allowed origins, rate limits and what happens at a plan limit.",
      },
      {
        href: "/docs/self-host/",
        title: "Self-host",
        description: "Run the Emojisense API on your own Cloudflare account.",
      },
      {
        href: "/docs/privacy/",
        title: "Privacy",
        description: "What Emojisense stores, what it never stores, and why.",
      },
    ],
  },
  {
    id: "resources",
    title: "Resources",
    pages: [
      {
        href: "/docs/changelog/",
        title: "Changelog",
        description: "Where the release notes are, and the status of every feature in these docs.",
      },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_SECTIONS.flatMap((section) => section.pages);

export function docsPage(href: string): DocsPage {
  const page = DOCS_PAGES.find((p) => p.href === href);
  if (!page) throw new Error(`No docs page registered for ${href}. Add it to src/lib/docs-nav.ts.`);
  return page;
}

export function docsSectionOf(href: string): DocsSection {
  const section = DOCS_SECTIONS.find((s) => s.pages.some((p) => p.href === href));
  if (!section) throw new Error(`No docs section has ${href}`);
  return section;
}

/** The pages before and after this one in reading order, across sections. */
export function docsNeighbors(href: string): { previous?: DocsPage; next?: DocsPage } {
  const index = DOCS_PAGES.findIndex((p) => p.href === href);
  const previous = index > 0 ? DOCS_PAGES[index - 1] : undefined;
  const next = index >= 0 ? DOCS_PAGES[index + 1] : undefined;
  return { ...(previous ? { previous } : {}), ...(next ? { next } : {}) };
}

/** Repository path of the file behind a page, for "Edit this page". */
export function docsSourceFile(page: DocsPage): string {
  if (page.source) return page.source;
  const route = page.href.replace(/^\/docs\/?/, "").replace(/\/$/, "");
  return `apps/web/src/pages/docs/${route === "" ? "index" : route}.astro`;
}
