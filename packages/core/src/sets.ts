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
  /**
   * Publishable key (`pk_live_…`). Hosted sets need a key whose plan includes them; the API
   * checks it against the page's origin (the `Referer` of the image request).
   */
  key?: string | undefined;
}

/**
 * Referrer policy for hosted set images: sends the page's origin (never its path) even when the
 * page's own policy is stricter, so the API can check the key's allowed origins.
 */
export const EMOJI_IMAGE_REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * The image URL of an emoji (skin tone included) in a hosted set. Returns undefined for the
 * "native" set or without an endpoint: draw the emoji as text then.
 */
export function emojiImageUrl(emoji: string, options: EmojiImageOptions): string | undefined {
  const { endpoint, emojiSet = "native", key } = options;
  if (emojiSet === "native" || !endpoint) return undefined;
  const query = key ? `?key=${encodeURIComponent(key)}` : "";
  return `${endpoint.replace(/\/+$/, "")}/v1/sets/${emojiSet}/${hexcodeOf(emoji)}.svg${query}`;
}
