export const SKIN_TONES = ["none", "light", "medium-light", "medium", "medium-dark", "dark"] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

const MODIFIERS: Record<Exclude<SkinTone, "none">, string> = {
  light: "\u{1F3FB}",
  "medium-light": "\u{1F3FC}",
  medium: "\u{1F3FD}",
  "medium-dark": "\u{1F3FE}",
  dark: "\u{1F3FF}",
};
const MODIFIER_BASE = /(\p{Emoji_Modifier_Base})️?/gu;
const ZWJ = "‍";
const HANDSHAKE = "\u{1F91D}";

/** Apply a skin tone to a base emoji: 👍 + medium → 👍🏽, 🧑‍🤝‍🧑 tones both people. */
export function applySkinTone(emoji: string, tone: SkinTone): string {
  if (tone === "none") return emoji;
  return emoji.replace(MODIFIER_BASE, (match, base: string, offset: number) =>
    // Inside "people holding hands" the 🤝 joins two people and takes no tone of its own.
    base === HANDSHAKE && emoji[offset - 1] === ZWJ ? match : `${base}${MODIFIERS[tone]}`,
  );
}
