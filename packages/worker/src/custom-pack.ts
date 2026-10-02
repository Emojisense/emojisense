import { type CustomEmojiRow, customEmojiImageUrl, storedAliases } from "@emojisense/platform";
import { CUSTOM_ID_PREFIX, normalize, type Pack, type PackRow } from "emojisense";

/** "Undetermined" (BCP 47): custom emoji belong to no locale and count for all of them. */
export const CUSTOM_PACK_LOCALE = "und";

/** FNV-1a, 32 bit: a short content version, so clients can tell two packs apart. */
function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** PACK_FORMAT.md §8: `[":shortcode:", "C-<id>", 0, 0, 0, shortcode, shortcode words, "", aliases, "", ""]`. */
export function customPackRow(row: CustomEmojiRow): PackRow {
  const aliases = storedAliases(row.aliases)
    .map((alias) => normalize(alias))
    .filter(Boolean);
  return [
    `:${row.shortcode}:`,
    `${CUSTOM_ID_PREFIX}${row.id}`,
    0,
    0,
    0,
    row.shortcode,
    normalize(row.shortcode),
    "",
    [...new Set(aliases)].join("|"),
    "",
    "",
  ];
}

/** The custom pack of one app (and tenant). `apiOrigin` is where the images are served. */
export function buildCustomPack(rows: readonly CustomEmojiRow[], apiOrigin: string): Pack {
  const emoji = rows.map(customPackRow);
  const images = Object.fromEntries(
    rows.map((row) => [`${CUSTOM_ID_PREFIX}${row.id}`, customEmojiImageUrl(apiOrigin, row.app_id, row.id)]),
  );
  return {
    format: "emojisense-pack",
    formatVersion: 1,
    packVersion: `custom-${contentHash(JSON.stringify([emoji, images]))}`,
    locale: CUSTOM_PACK_LOCALE,
    part: "custom",
    emojiVersion: "",
    groups: ["custom"],
    emoji,
    images,
  };
}
