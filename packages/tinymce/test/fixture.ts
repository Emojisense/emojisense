import { createEngine, type Pack, type PackRow, type SemanticProvider } from "emojisense";

const row = (
  emoji: string,
  hexcode: string,
  label: string,
  fields: Partial<Record<"shortcode" | "keyword" | "alias", string>>,
  skins: 0 | 1 = 0,
): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  skins,
  label,
  fields.shortcode ?? "",
  fields.keyword ?? "",
  fields.alias ?? "",
  "",
  "",
];

export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: [
    row("🍕", "1F355", "pizza", { keyword: "food|slice" }),
    row("🚀", "1F680", "rocket", { keyword: "space", alias: "ship it|launch" }),
    row("👍", "1F44D", "thumbs up", { shortcode: "+1|thumbsup", keyword: "good|like" }, 1),
    row("🦖", "1F996", "T-Rex", { keyword: "dinosaur", alias: "jurassic park" }),
  ],
};

export const engine = createEngine(en);

/** A language the tests' user does not speak: "foguete" is only Portuguese. */
export const pt: Pack = {
  ...en,
  locale: "pt",
  emoji: [row("🚀", "1F680", "foguete", { keyword: "espaço" })],
};

/** Knows "blastoff" → 🚀 after `delayMs`. */
export function stubSemantic(delayMs = 0): SemanticProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async search(query) {
      calls.push(query);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!query.startsWith("blastoff")) return undefined;
      return {
        results: [{ emoji: "🚀", id: "1F680", score: 0.7, source: "semantic" }],
        packVersion: "test",
        cached: false,
        layer: "api",
      };
    },
  };
}
