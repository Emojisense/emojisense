import type { Pack, PackRow } from "emojisense";

const row = (emoji: string, hexcode: string, label: string, keyword: string, alias: string): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  keyword,
  alias,
  "",
  "",
];

/** A tiny English pack: enough for the Worker gate and the fake resolver. */
export const pack: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: [
    row("🚀", "1F680", "rocket", "space", "ship it|launch|deploy"),
    row("🎉", "1F389", "party popper", "party|celebration", "congrats|tada"),
    row("🔥", "1F525", "fire", "flame|hot", "lit|on fire"),
    row("🐶", "1F436", "dog face", "dog|puppy", "good boy"),
    row("😢", "1F622", "crying face", "sad|tear", "so sad"),
    row("🇹🇷", "1F1F9-1F1F7", "flag: Türkiye", "flag", "turkey"),
  ],
};

export const catalog = pack.emoji.map(([emoji, id]) => ({ emoji, id }));
