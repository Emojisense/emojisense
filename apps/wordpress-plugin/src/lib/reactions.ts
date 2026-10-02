/** Where a post's reactions come from (the same order as Emojisense_Reactions::reaction_set). */
export type ReactionSource = "chosen" | "suggested" | "defaults";

/** The reactions a post offers: the author's choice, else the suggestion, else the defaults. */
export function effectiveReactions(
  chosen: readonly string[] | undefined,
  suggested: readonly string[] | undefined,
  defaults: readonly string[],
): { list: string[]; source: ReactionSource } {
  if (chosen && chosen.length > 0) return { list: [...chosen], source: "chosen" };
  if (suggested && suggested.length > 0) return { list: [...suggested], source: "suggested" };
  return { list: [...defaults], source: "defaults" };
}

/** Adds an emoji at the end, once, keeping at most `max`. */
export function withReaction(list: readonly string[], emoji: string, max: number): string[] {
  if (list.includes(emoji)) return [...list];
  return [...list, emoji].slice(0, max);
}

export function withoutReaction(list: readonly string[], emoji: string): string[] {
  return list.filter((item) => item !== emoji);
}

/** "2764-FE0F" → "❤️": the reaction buttons carry code points (see the PHP render()). */
export function emojiFromHex(hex: string): string {
  if (!/^[0-9A-Fa-f]{1,6}(-[0-9A-Fa-f]{1,6}){0,15}$/.test(hex)) return "";
  try {
    return String.fromCodePoint(...hex.split("-").map((part) => Number.parseInt(part, 16)));
  } catch {
    return "";
  }
}

/** One counter as the page shows it, in the page language ("1,204"). */
export function formatCount(count: number, locale?: string): string {
  const value = Math.max(0, Math.trunc(count));
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    // An invalid `lang` attribute ("en_US") must not break the bar.
    return new Intl.NumberFormat().format(value);
  }
}

/**
 * The reactions this browser gave, per post, in localStorage. Nothing about them is sent or
 * stored elsewhere; it only lets a visitor take a reaction back.
 */
export interface ReactedStore {
  get(postId: number): Set<string>;
  toggle(postId: number, emoji: string, on: boolean): void;
}

const STORAGE_KEY = "emojisense:reactions";
/** Not a bare number: object keys that look like integers lose their insertion order. */
const keyOf = (postId: number) => `p${postId}`;
const MAX_POSTS = 200;

export function createReactedStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined): ReactedStore {
  const read = (): Record<string, string[]> => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string[]>)
        : {};
    } catch {
      return {};
    }
  };
  return {
    get(postId) {
      const list = read()[keyOf(postId)];
      return new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
    },
    toggle(postId, emoji, on) {
      const all = read();
      const key = keyOf(postId);
      const current = new Set(Array.isArray(all[key]) ? all[key] : []);
      if (on) current.add(emoji);
      else current.delete(emoji);
      delete all[key];
      if (current.size > 0) all[key] = [...current];
      // Keys keep insertion order and a changed post moves to the end: keep the newest MAX_POSTS.
      const keys = Object.keys(all);
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_POSTS))) delete all[old];
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(all));
      } catch {
        // Private mode or a full quota: the reaction still counts, it just cannot be taken back.
      }
    },
  };
}
