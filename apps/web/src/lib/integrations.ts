/**
 * Every integration, once: the landing page's hub and the /integrations/ page both read this list.
 * Names and blurbs live in the catalogs (integrations.items.<key>).
 *
 * `status` is what a visitor can install today. Set it to "available" in the release that publishes
 * the package or the store listing; the install panel then shows `command`.
 */
import type { LogoName } from "./logos";

export type IntegrationKey =
  | "react"
  | "webComponent"
  | "engine"
  | "tiptap"
  | "lexical"
  | "emojiMart"
  | "ckeditor5"
  | "tinymce"
  | "swift"
  | "chrome"
  | "raycast"
  | "wordpress"
  | "discourse"
  | "mcp"
  | "http"
  | "selfHosted";

export type GroupId = "frameworks" | "editors" | "native" | "servers";

export type Status = "available" | "soon";

export type Channel = "npm" | "swift" | "chrome" | "raycast" | "wordpress" | "discourse" | "source";

export interface Integration {
  key: IntegrationKey;
  /** Anchor of its card on /integrations/. */
  slug: string;
  group: GroupId;
  logos: LogoName[];
  /** A typographic mark for an integration without a brand, e.g. the HTTP API. */
  mark?: string;
  status: Status;
  /** Where it will be published; names the "Coming soon" line while it is not available. */
  channel?: Channel;
  /** Install command, shown once the integration is available. */
  command?: string;
  /** Shown before the command; "" for a snippet that is not a shell command. */
  prompt?: string;
  docs: string;
}

export const GROUPS: readonly GroupId[] = ["frameworks", "editors", "native", "servers"];

export const INTEGRATIONS: readonly Integration[] = [
  {
    key: "react",
    slug: "react",
    group: "frameworks",
    logos: ["react", "frimousse"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/react frimousse",
    docs: "/docs/integrations/react/",
  },
  {
    key: "webComponent",
    slug: "web-component",
    group: "frameworks",
    logos: ["vue", "svelte", "angular", "javascript"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/web-component",
    docs: "/docs/integrations/web-component/",
  },
  {
    key: "engine",
    slug: "engine",
    group: "frameworks",
    logos: ["javascript", "typescript"],
    status: "available",
    channel: "npm",
    command: "npm i emojisense",
    docs: "/docs/sdk/",
  },
  {
    // `:fire:` → 🔥 (in the blurb) is asserted in packages/tiptap/test/extension.test.ts.
    key: "tiptap",
    slug: "tiptap",
    group: "editors",
    logos: ["tiptap"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/tiptap emojisense",
    docs: "/docs/integrations/tiptap/",
  },
  {
    key: "lexical",
    slug: "lexical",
    group: "editors",
    logos: ["lexical"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/lexical emojisense",
    docs: "/docs/integrations/lexical/",
  },
  {
    key: "ckeditor5",
    slug: "ckeditor5",
    group: "editors",
    logos: ["ckeditor"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/ckeditor5 emojisense",
    docs: "/docs/integrations/ckeditor5/",
  },
  {
    key: "tinymce",
    slug: "tinymce",
    group: "editors",
    logos: ["tinymce"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/tinymce emojisense",
    docs: "/docs/integrations/tinymce/",
  },
  {
    key: "emojiMart",
    slug: "emoji-mart",
    group: "editors",
    logos: ["emojiMart"],
    status: "available",
    channel: "npm",
    command: "npm i @emojisense/emoji-mart emojisense",
    docs: "/docs/integrations/emoji-mart/",
  },
  {
    key: "chrome",
    slug: "chrome",
    group: "native",
    logos: ["chrome"],
    status: "soon",
    channel: "chrome",
    docs: "/docs/integrations/chrome/",
  },
  {
    key: "raycast",
    slug: "raycast",
    group: "native",
    logos: ["raycast"],
    status: "soon",
    channel: "raycast",
    docs: "/docs/integrations/raycast/",
  },
  {
    key: "wordpress",
    slug: "wordpress",
    group: "native",
    logos: ["wordpress"],
    status: "soon",
    channel: "wordpress",
    docs: "/docs/integrations/wordpress/",
  },
  {
    key: "discourse",
    slug: "discourse",
    group: "native",
    logos: ["discourse"],
    status: "soon",
    channel: "discourse",
    docs: "/docs/integrations/discourse/",
  },
  {
    key: "swift",
    slug: "swift",
    group: "native",
    logos: ["swift", "apple"],
    status: "soon",
    channel: "swift",
    docs: "/docs/integrations/swift/",
  },
  {
    key: "mcp",
    slug: "mcp",
    group: "servers",
    logos: ["mcp"],
    status: "available",
    channel: "npm",
    command: "npx -y @emojisense/mcp",
    docs: "/docs/integrations/mcp/",
  },
  {
    key: "http",
    slug: "http",
    group: "servers",
    logos: [],
    mark: "GET /v1",
    status: "available",
    command: 'curl "https://api.emojisense.com/v1/search?q=ship+it"',
    docs: "/docs/integrations/http/",
  },
  {
    key: "selfHosted",
    slug: "self-hosted",
    group: "servers",
    logos: ["cloudflare"],
    status: "soon",
    channel: "source",
    docs: "/docs/self-host/",
  },
];

/** A brand on the landing page's hub, and the integration that serves it. */
export interface HubBrand {
  key: IntegrationKey;
  logo?: LogoName;
  mark?: string;
}

/** The landing page shows brands people look for, so Vue and Svelte lead to the web component. */
export const HUB: Record<GroupId, HubBrand[]> = {
  frameworks: [
    { key: "react", logo: "react" },
    { key: "webComponent", logo: "vue" },
    { key: "webComponent", logo: "svelte" },
    { key: "webComponent", logo: "angular" },
    { key: "engine", logo: "javascript" },
  ],
  editors: [
    { key: "tiptap", logo: "tiptap" },
    { key: "lexical", logo: "lexical" },
    { key: "ckeditor5", logo: "ckeditor" },
    { key: "tinymce", logo: "tinymce" },
    { key: "emojiMart", logo: "emojiMart" },
  ],
  native: [
    { key: "chrome", logo: "chrome" },
    { key: "raycast", logo: "raycast" },
    { key: "wordpress", logo: "wordpress" },
    { key: "discourse", logo: "discourse" },
    { key: "swift", logo: "swift" },
  ],
  servers: [
    { key: "mcp", logo: "mcp" },
    { key: "http", mark: "GET /v1" },
    { key: "selfHosted", logo: "cloudflare" },
  ],
};

export function integrationOf(key: IntegrationKey): Integration {
  const integration = INTEGRATIONS.find((item) => item.key === key);
  if (!integration) throw new Error(`No integration "${key}" in src/lib/integrations.ts`);
  return integration;
}

export function integrationsIn(group: GroupId): Integration[] {
  return INTEGRATIONS.filter((integration) => integration.group === group);
}

/** The link from the landing page's hub to a card on /integrations/. */
export function cardPath(integration: Integration): string {
  return `/integrations/#${integration.slug}`;
}
