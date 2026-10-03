import { CUSTOM_ID_PREFIX, normalize, type Pack, type PackRow } from "emojisense";

/** A site's custom emoji, as Discourse preloads them (`PreloadStore.get("customEmoji")`). */
export interface DiscourseCustomEmoji {
  name: string;
  url: string;
}

/**
 * The site's custom emoji as a custom pack (PACK_FORMAT.md §8), so they are searched next to the
 * standard set. The name is the only text a custom emoji has: "party_parrot" matches "party parrot".
 */
export function customEmojiPack(list: readonly DiscourseCustomEmoji[]): Pack | undefined {
  const rows: PackRow[] = [];
  const images: Record<string, string> = {};
  for (const { name, url } of list) {
    if (!name || !url) continue;
    const id = `${CUSTOM_ID_PREFIX}${name}`;
    rows.push([
      `:${name}:`,
      id,
      0,
      0,
      0,
      name,
      normalize(name),
      "",
      normalize(name.replace(/[_-]+/g, " ")),
      "",
      "",
    ]);
    images[id] = url;
  }
  if (rows.length === 0) return undefined;
  return {
    format: "emojisense-pack",
    formatVersion: 1,
    packVersion: "discourse-custom",
    locale: "und",
    part: "custom",
    emojiVersion: "",
    groups: ["custom"],
    emoji: rows,
    images,
  };
}
