import { hexcodeOf } from "./ids.js";

/**
 * How pickers draw emoji. "native" draws the text with the system font. The other sets are
 * images that the API hosts at `/v1/sets/<set>/<hexcode>.svg` (docs/API.md, NOTICE).
 */
export const EMOJI_SETS = ["native", "twemoji", "noto", "fluent"] as const;
export type EmojiSet = (typeof EMOJI_SETS)[number];
export type HostedEmojiSet = Exclude<EmojiSet, "native">;

export function isEmojiSet(value: unknown): value is EmojiSet {
  return EMOJI_SETS.includes(value as EmojiSet);
}

export interface EmojiImageOptions {
  /** Base URL of the Emojisense API, e.g. "https://api.emojisense.com". */
  endpoint?: string | undefined;
  /** Default "native". */
  emojiSet?: EmojiSet | undefined;
}

/**
 * The image URL of an emoji (skin tone included) in a hosted set. Returns undefined for the
 * "native" set or without an endpoint: draw the emoji as text then.
 */
export function emojiImageUrl(emoji: string, options: EmojiImageOptions): string | undefined {
  const { endpoint, emojiSet = "native" } = options;
  if (emojiSet === "native" || !endpoint) return undefined;
  return `${endpoint.replace(/\/+$/, "")}/v1/sets/${emojiSet}/${hexcodeOf(emoji)}.svg`;
}
