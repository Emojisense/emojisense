const SKIN_TONE = /-1F3F[B-F]/g;
const VARIATION_SELECTOR_16 = 0xfe0f;

/** Map a skin-tone variant hexcode ("1F44D-1F3FD") to its base ("1F44D"). */
export function baseId(hexcode: string): string {
  return hexcode.toUpperCase().replace(SKIN_TONE, "");
}

/**
 * The Emojibase hexcode of an emoji, with or without a skin tone: "👍🏽" → "1F44D-1F3FD",
 * "❤️" → "2764", "❤️‍🔥" → "2764-FE0F-200D-1F525". Like Emojibase, it drops U+FE0F only when
 * it follows a single code point. Pack rows store the same value for base emoji.
 */
export function hexcodeOf(emoji: string): string {
  const codePoints = Array.from(emoji, (char) => char.codePointAt(0) as number);
  const kept =
    codePoints.length === 2 && codePoints[1] === VARIATION_SELECTOR_16 ? codePoints.slice(0, 1) : codePoints;
  return kept.map((codePoint) => codePoint.toString(16).toUpperCase().padStart(4, "0")).join("-");
}
