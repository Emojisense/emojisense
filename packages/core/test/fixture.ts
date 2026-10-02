import type { Pack, PackRow } from "../src/pack.js";

export const row = (
  emoji: string,
  hexcode: string,
  label: string,
  fields: Partial<Record<"shortcode" | "keyword" | "alias" | "typo" | "low", string>>,
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
    row("👍", "1F44D", "thumbs up", {
      shortcode: "+1|thumbsup",
      keyword: "good|like|yes",
      alias: "lgtm|approve",
    }),
    row("🔥", "1F525", "fire", { keyword: "flame|hot", alias: "on fire|lit|hotfix" }),
    row("🚒", "1F692", "fire engine", { keyword: "engine|truck" }),
    row("🚀", "1F680", "rocket", { keyword: "space", alias: "ship it|launch|deploy|to the moon" }),
    row("🦖", "1F996", "T-Rex", {
      keyword: "dinosaur|tyrannosaurus",
      alias: "jurassic park|dino",
      typo: "dinasour",
    }),
    row("🐐", "1F410", "goat", { alias: "greatest of all time|goat" }),
    row("🎃", "1F383", "jack-o-lantern", { keyword: "halloween|pumpkin" }),
    row("🎂", "1F382", "birthday cake", { keyword: "birthday|cake", alias: "happy birthday" }),
  ],
};

/** An app's custom emoji, as GET /v1/custom-pack serves them (PACK_FORMAT.md §8). */
export const custom: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "custom-1a2b3c4d",
  locale: "und",
  part: "custom",
  emojiVersion: "",
  groups: ["custom"],
  emoji: [
    [":party_parrot:", "C-e1", 0, 0, 0, "party_parrot", "party parrot", "", "celebrate|dance", "", ""],
    [":shipit:", "C-e2", 0, 0, 0, "shipit", "shipit", "", "ship it|squirrel", "", ""],
  ],
  images: {
    "C-e1": "https://api.test/v1/custom/app1/e1",
    "C-e2": "https://api.test/v1/custom/app1/e2",
  },
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [
    row("👍", "1F44D", "baş parmak yukarıda", { keyword: "tamam|onay" }),
    row("🎂", "1F382", "doğum günü pastası", { keyword: "dogum gunu|pasta", alias: "iyi ki dogdun" }),
  ],
};
