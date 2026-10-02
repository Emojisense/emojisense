import { type EmojiSet, emojiImageUrl } from "emojisense";
import { API_URL } from "./config";

/** A spread of faces, objects and newer emoji, so the sets' styles are easy to compare. */
export const PREVIEW_EMOJI = ["🎉", "😂", "🔥", "🚀", "🥳", "👀", "🫠", "🐙", "🌮", "💯"];

export const SET_INFO: Record<EmojiSet, { name: string; text: string; credit: string; note?: string }> = {
  native: {
    name: "Native",
    text: "The device’s own emoji font. Nothing to download; it looks different on each system.",
    credit: "Apple, Google, Microsoft or Samsung, depending on the device",
  },
  twemoji: {
    name: "Twemoji",
    text: "Flat and friendly. Familiar from X and Discord.",
    credit: "Twemoji by X Corp. and contributors, CC BY 4.0",
  },
  noto: {
    name: "Noto",
    text: "Google’s set: rounded, warm and very complete.",
    credit: "Noto Emoji by Google, Apache 2.0",
  },
  fluent: {
    name: "Fluent",
    text: "Microsoft’s soft 3D style, with depth and light.",
    credit: "Fluent Emoji by Microsoft, MIT",
    note: "Covers about 88% of emoji: no country flags, families or couples, and no Emoji 16 or 17. Those show as native emoji.",
  },
};

/** `${API_URL}/v1/sets/<set>/<hexcode>.svg`, or undefined for the native set. */
export function setImageUrl(set: EmojiSet, emoji: string): string | undefined {
  return emojiImageUrl(emoji, { endpoint: API_URL, emojiSet: set });
}
