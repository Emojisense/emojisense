import { createEngine, type Pack, type PackRow } from "emojisense";

const GROUPS = [
  "smileys-emotion",
  "people-body",
  "animals-nature",
  "activities",
  "travel-places",
  "objects",
  "flags",
] as const;
type Group = (typeof GROUPS)[number];

const row = (
  emoji: string,
  hexcode: string,
  group: Group,
  label: string,
  fields: Partial<Record<"shortcode" | "keyword" | "alias" | "typo" | "low", string>> = {},
): PackRow => [
  emoji,
  hexcode,
  GROUPS.indexOf(group),
  1,
  0,
  label,
  fields.shortcode ?? "",
  fields.keyword ?? "",
  fields.alias ?? "",
  fields.typo ?? "",
  fields.low ?? "",
];

/** A tiny English pack: reaction emoji, topical emoji, and the traps the text matcher avoids. */
export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: [...GROUPS],
  emoji: [
    row("👍", "1F44D", "people-body", "thumbs up", { shortcode: "+1|thumbsup", keyword: "good|like|yes" }),
    row("❤️", "2764", "smileys-emotion", "red heart", { keyword: "love", alias: "thank you" }),
    row("👀", "1F440", "people-body", "eyes", { keyword: "look", alias: "will review|looking into it" }),
    row("🤔", "1F914", "smileys-emotion", "thinking face", { keyword: "hmm|ponder" }),
    row("🙏", "1F64F", "people-body", "folded hands", { keyword: "please|thanks", alias: "thank you" }),
    row("🎉", "1F389", "activities", "party popper", {
      keyword: "party|celebrate",
      alias: "congrats|we launched",
      low: "shipped",
    }),
    row("🔥", "1F525", "travel-places", "fire", { keyword: "flame|hot", alias: "on fire|lit" }),
    row("🚒", "1F692", "travel-places", "fire engine", { keyword: "fire|truck" }),
    row("🚢", "1F6A2", "travel-places", "ship", { keyword: "boat", alias: "shipped" }),
    row("🚚", "1F69A", "travel-places", "delivery truck", { alias: "order shipped" }),
    row("🎂", "1F382", "objects", "birthday cake", { keyword: "birthday|cake", alias: "happy birthday" }),
    row("🆕", "1F195", "objects", "NEW button", { keyword: "new" }),
    row("🇵🇷", "1F1F5-1F1F7", "flags", "flag: Puerto Rico", { keyword: "pr" }),
    row("🦖", "1F996", "animals-nature", "T-Rex", { keyword: "dinosaur", alias: "jurassic park" }),
  ],
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [row("🎂", "1F382", "objects", "doğum günü pastası", { alias: "iyi ki dogdun" })],
};

export const engine = createEngine([en, tr]);
