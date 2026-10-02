import { createEngine, type Pack, type PackRow } from "emojisense";

const row = (
  emoji: string,
  hexcode: string,
  label: string,
  fields: Partial<Record<"shortcode" | "keyword" | "alias" | "typo" | "low", string>> = {},
): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  fields.shortcode ?? "",
  fields.keyword ?? "",
  fields.alias ?? "",
  fields.typo ?? "",
  fields.low ?? "",
];

export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: [
    row("👍", "1F44D", "thumbs up", { shortcode: "+1|thumbsup", keyword: "good", alias: "lgtm" }),
    row("🚀", "1F680", "rocket", { keyword: "space", alias: "ship it", low: "to the moon" }),
    row("🦖", "1F996", "T-Rex", { keyword: "dinosaur", alias: "jurassic park", typo: "dinasour" }),
    row("🎂", "1F382", "birthday cake", { keyword: "birthday" }),
  ],
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [row("🎂", "1F382", "doğum günü pastası", { alias: "iyi ki dogdun" })],
};

export const engine = createEngine([en, tr]);
