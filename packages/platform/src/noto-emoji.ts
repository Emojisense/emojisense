/**
 * Noto Emoji art at one pinned commit: the hosted "noto" set of the API (packages/worker) and the
 * website's share cards draw the same files. Licenses and attribution: NOTICE.
 *
 * A subpath export (`@emojisense/platform/noto-emoji`), so a Worker that needs only this does not
 * bundle the rest of the platform package.
 */

export const NOTO_EMOJI = {
  repo: "googlefonts/noto-emoji",
  commit: "e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e",
  release: "v2026-09-24-unicode18_0",
  license: { spdx: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
} as const;

const VARIATION_SELECTOR_16 = 0xfe0f;
const BLACK_FLAG = 0x1f3f4;
const isRegionalIndicator = (codePoint: number) => codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
const isTag = (codePoint: number) => codePoint >= 0xe0020 && codePoint <= 0xe007f;

/**
 * Noto names files `emoji_u<hex>_<hex>.svg` without U+FE0F. Country and subdivision flags are the
 * waved flags the Noto font uses; everything else is in `2D/svg`. At the pinned commit the rule
 * matches every pack emoji (`pnpm --filter @emojisense/worker sets` checks it).
 */
export function notoEmojiPath(emoji: string): string {
  const codePoints = Array.from(emoji, (char) => char.codePointAt(0) as number).filter(
    (codePoint) => codePoint !== VARIATION_SELECTOR_16,
  );
  const name = `emoji_u${codePoints.map((codePoint) => codePoint.toString(16).padStart(4, "0")).join("_")}.svg`;
  const [first = 0, second = 0] = codePoints;
  const flag =
    (codePoints.length === 2 && isRegionalIndicator(first) && isRegionalIndicator(second)) ||
    (first === BLACK_FLAG && isTag(second));
  return flag ? `third_party/region-flags/waved-svg/${name}` : `2D/svg/${name}`;
}

export type NotoPngSize = 32 | 72 | 128 | 512;

/**
 * Noto's own rendering of an emoji's SVG (`2D/png/<size>/`), for renderers that draw some of the
 * SVGs wrong (several carry hidden layers and art outside their view box). Flags have none.
 */
export function notoEmojiPngPath(emoji: string, size: NotoPngSize): string | undefined {
  const path = notoEmojiPath(emoji);
  return path.startsWith("2D/svg/")
    ? `2D/png/${size}/${path.slice("2D/svg/".length, -".svg".length)}.png`
    : undefined;
}

/** The immutable jsDelivr URL of a repository path at the pinned commit. */
export function notoEmojiUrl(path: string): string {
  return `https://cdn.jsdelivr.net/gh/${NOTO_EMOJI.repo}@${NOTO_EMOJI.commit}/${path}`;
}
