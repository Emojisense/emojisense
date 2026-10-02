/**
 * Landing page copy that states facts about the product. test/claims.test.ts checks the search
 * claims against the real data pack, so a data change cannot make this page lie.
 */

export const HERO_QUERY = "jurassic park";
export interface Example {
  query: string;
  /** Says what kind of language the query is (never the answer, which would spoil it). */
  emoji: string;
  kind: string;
}

export const HERO_EXAMPLES: Example[] = [
  { query: "jurassic park", emoji: "🎬", kind: "Film" },
  { query: "greatest of all time", emoji: "🗣️", kind: "Slang" },
  { query: "hallowelen", emoji: "⌨️", kind: "Typo" },
  { query: "mind blown", emoji: "💬", kind: "Idiom" },
  { query: "it is what it is", emoji: "💬", kind: "Phrase" },
  { query: "out of office", emoji: "💼", kind: "Intent" },
  { query: "spill the tea", emoji: "🗣️", kind: "Slang" },
];

export interface SearchClaim {
  query: string;
  /** What kind of language the query is. */
  kind: string;
  locale: "en" | "tr";
  /** The top on-device results, best first (the claim: name search finds none of them). */
  top: { emoji: string; id: string }[];
}

export const SEARCH_CLAIMS: SearchClaim[] = [
  {
    query: "greatest of all time",
    kind: "Slang",
    locale: "en",
    top: [{ emoji: "🐐", id: "1F410" }],
  },
  {
    query: "hallowelen",
    kind: "Typo",
    locale: "en",
    top: [{ emoji: "🎃", id: "1F383" }],
  },
  {
    query: "jurassic park",
    kind: "Film",
    locale: "en",
    top: [
      { emoji: "🦕", id: "1F995" },
      { emoji: "🦖", id: "1F996" },
    ],
  },
  {
    query: "mind blown",
    kind: "Idiom",
    locale: "en",
    top: [{ emoji: "🤯", id: "1F92F" }],
  },
  {
    query: "out of office",
    kind: "Intent",
    locale: "en",
    top: [{ emoji: "🏖️", id: "1F3D6" }],
  },
  {
    query: "afiyet olsun",
    kind: "Turkish",
    locale: "tr",
    top: [{ emoji: "😋", id: "1F60B" }],
  },
];

export type LayerStatus = "live" | "building" | "later";

export interface Layer {
  id: string;
  emoji: string;
  name: string;
  where: string;
  cost: string;
  speed: string;
  status: LayerStatus;
  note: string;
}

/** docs/ARCHITECTURE.md, "Layers". Keep the states honest when they change. */
export const LAYERS: Layer[] = [
  {
    id: "L0",
    emoji: "📱",
    name: "Alias dictionary",
    where: "On the device",
    cost: "$0",
    speed: "0.4 ms p95 per keystroke",
    status: "live",
    note: "More than 80,000 aliases for 1,914 emoji: slang, films, idioms, intent and Turkish, plus common typos. Works offline.",
  },
  {
    id: "L1",
    emoji: "🧠",
    name: "On-device model",
    where: "On the device",
    cost: "$0",
    speed: "—",
    status: "later",
    note: "Not yet. No small multilingual model fits on a phone unchanged, so this slot stays empty for now.",
  },
  {
    id: "L2",
    emoji: "🗂️",
    name: "Precomputed results",
    where: "Static files at the edge",
    cost: "$0",
    speed: "10–30 ms first fetch, then local",
    status: "building",
    note: "Results for frequent queries, split by prefix. One small file answers every query that starts the same way.",
  },
  {
    id: "L3",
    emoji: "☁️",
    name: "Semantic search",
    where: "Cloudflare Worker",
    cost: "About $0.50–1.40 per 1M calls",
    speed: "+20–80 ms",
    status: "live",
    note: "Embeds the query with an off-the-shelf model and compares it with all 1,914 emoji. Only unsure queries get here.",
  },
];

export const STATUS_LABEL: Record<LayerStatus, string> = {
  live: "Live",
  building: "In progress",
  later: "Later",
};

export type IntegrationStatus = "available" | "building";

export interface Integration {
  name: string;
  /** An emoji that hints at the integration. Never a third-party logo. */
  emoji: string;
  /** Package or app name, shown in mono. */
  package: string;
  summary: string;
  status: IntegrationStatus;
}

/** docs/INTEGRATIONS.md, "Roadmap and status" (2026-10-02). */
export const INTEGRATIONS: Integration[] = [
  {
    name: "React",
    emoji: "⚛️",
    package: "@emojisense/react",
    summary: "Two hooks, useEmojisense and useEmojiSearch, for any picker UI you already have.",
    status: "available",
  },
  {
    name: "Frimousse",
    emoji: "🐭",
    package: "@emojisense/react/frimousse",
    summary: "Keeps the Frimousse browse view. Emojisense ranks the results as you type.",
    status: "available",
  },
  {
    name: "Web component",
    emoji: "🧩",
    package: "@emojisense/web-component",
    summary: "One <emojisense-picker> element for Vue, Svelte, Angular and plain HTML.",
    status: "building",
  },
  {
    name: "Tiptap and Lexical",
    emoji: "✍️",
    package: "@emojisense/tiptap · @emojisense/lexical",
    summary: "Type a colon in the editor and get emoji suggestions that understand the word after it.",
    status: "building",
  },
  {
    name: "Chrome",
    emoji: "🌐",
    package: "Chrome extension",
    summary: "Emoji search in text fields on any site. The data ships inside the extension.",
    status: "building",
  },
  {
    name: "Raycast",
    emoji: "⌨️",
    package: "Raycast extension",
    summary: "Find an emoji from the launcher, then copy or paste it.",
    status: "building",
  },
  {
    name: "MCP",
    emoji: "🤖",
    package: "@emojisense/mcp",
    summary: "Tools for AI agents: search_emoji, emoji_for_text and suggest_reactions.",
    status: "building",
  },
];

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  available: "Available",
  building: "In progress",
};

export interface Faq {
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    question: "Does it work offline?",
    answer:
      "Yes. The alias dictionary runs on the device and needs no network after the first load. Without a connection you keep the dictionary results. Semantic results come back when the connection does.",
  },
  {
    question: "What happens when an app reaches its plan limit?",
    answer:
      "Search keeps working. The API answers with overLimit: true, and the SDK stays on the on-device dictionary and the precomputed results until the next month starts (UTC). Nothing fails and no error reaches your users.",
  },
  {
    question: "Do you store what people type?",
    answer:
      "Searches answered on the device never leave it. Precomputed results come from static files, which are not logged or metered. For searches that reach the Worker, we keep only the normalized text, up to 64 characters, with no IP address, key or user id. A query is used only after at least 5 searches for it. Text sent for reaction suggestions and images are never stored.",
  },
  {
    question: "Which languages and emoji does it know?",
    answer:
      "English and Turkish today, for all 1,914 emoji of Emoji 17.0. Skin-tone variants map to their base emoji, and your picker applies the tone. Emoji draw with the system font.",
  },
  {
    question: "Do I need React?",
    answer:
      "No. The core engine has no dependencies and works in browsers, Node, Deno, Bun, Workers and extensions. React hooks, a Frimousse adapter and a web component sit on top of it.",
  },
  {
    question: "Which AI model does the semantic search use?",
    answer:
      "An off-the-shelf embedding model on Cloudflare Workers AI, chosen by recall on our labelled query set, then latency, then cost. We do not train or ship model weights.",
  },
];
