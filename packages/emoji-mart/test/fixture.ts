import data from "@emoji-mart/data/sets/15/native.json" with { type: "json" };
import { createEngine, type Pack, type PackRow } from "emojisense";
import type { EmojiMartData } from "../src/map.js";

const row = (emoji: string, hexcode: string, label: string, alias: string, skins: 0 | 1 = 0): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  skins,
  label,
  "",
  "",
  alias,
  "",
  "",
];

/** Includes an Emoji 16 face that emoji-mart's data (Emoji 15) does not have. */
export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["smileys-emotion"],
  emoji: [
    row("👍", "1F44D", "thumbs up", "lgtm|approve", 1),
    row("🦖", "1F996", "T-Rex", "jurassic park|dino"),
    row("🐐", "1F410", "goat", "greatest of all time"),
    row("🚀", "1F680", "rocket", "ship it|launch"),
    row("❤️", "2764", "red heart", "love"),
    row("🫩", "1FAE9", "face with bags under eyes", "exhausted|tired"),
  ],
};

export const engine = createEngine(en);

/** A language the tests' user does not speak: "foguete" is only Portuguese. */
export const pt: Pack = { ...en, locale: "pt", emoji: [row("🚀", "1F680", "foguete", "espaço")] };

/** Real emoji-mart data. emoji-mart's `init` mutates it, so tests that call `init` share it. */
export const emojiMartData = data as unknown as EmojiMartData;
