import { createEngine, type Pack, type PackRow, type SemanticProvider } from "emojisense";

export const row = (
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

/** Rows that also match "jurassic" come first, so 🦖 must win on score, not on pack order. */
export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: [
    row("🦟", "1F99F", "mosquito", { keyword: "insect|bug", alias: "jurassic park amber" }),
    row("🦕", "1F995", "sauropod", { keyword: "dinosaur|brontosaurus", alias: "dino|longneck" }),
    row("🦖", "1F996", "T-Rex", {
      shortcode: "trex",
      keyword: "dinosaur|tyrannosaurus",
      alias: "jurassic park|jurassic world|dino",
    }),
    row("👍️", "1F44D", "thumbs up", { shortcode: "+1|thumbsup", keyword: "good|like|yes", alias: "lgtm" }, 1),
    row("🔥", "1F525", "fire", { keyword: "flame|hot", alias: "lit" }),
    row("🚀", "1F680", "rocket", { keyword: "space", alias: "ship it|launch" }),
    row("🎉", "1F389", "party popper", { shortcode: "tada", keyword: "party|celebrate" }),
    row("😅", "1F605", "grinning face with sweat", { shortcode: "sweat smile" }),
  ],
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [
    row("🦖", "1F996", "T-Rex", { keyword: "dinozor" }),
    row("🚀", "1F680", "roket", { keyword: "uzay" }),
  ],
};

export const engine = createEngine(en);

/** A language the tests' user does not speak: "foguete" is only Portuguese. */
export const pt: Pack = {
  ...en,
  locale: "pt",
  emoji: [row("🚀", "1F680", "foguete", { keyword: "espaço" })],
};

/** A semantic layer that knows one concept the alias pack does not. */
export function stubSemantic(): SemanticProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async search(query) {
      calls.push(query);
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
