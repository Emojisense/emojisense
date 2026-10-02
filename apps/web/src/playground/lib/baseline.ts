import type { EmojiEntry } from "emojisense";

/**
 * The search most pickers ship: a substring match on the emoji's name. Same data as Emojisense,
 * without aliases, typos, other languages or meaning. Used only to show the difference.
 */
export function countNameMatches(entries: readonly EmojiEntry[], query: string, locale: string): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  let count = 0;
  for (const entry of entries) {
    const name = entry.labels[locale] ?? entry.labels.en ?? "";
    if (name.toLocaleLowerCase().includes(needle)) count++;
  }
  return count;
}
