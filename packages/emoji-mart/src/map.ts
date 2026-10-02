import type { SearchResult } from "emojisense";

/** One skin of an emoji in `@emoji-mart/data` (index 0 = no tone, 1–5 = light → dark). */
export interface EmojiMartSkin {
  unified: string;
  native: string;
  /** Set by emoji-mart's `init`. */
  shortcodes?: string;
  /** Custom emoji only. */
  src?: string;
}

/** An emoji in `@emoji-mart/data`. Only the fields this adapter reads. */
export interface EmojiMartEmoji {
  id: string;
  name: string;
  keywords: string[];
  skins: EmojiMartSkin[];
  version: number;
  emoticons?: string[];
  aliases?: string[];
  /** emoji-mart's `init` sets it on every emoji its picker lists (supported version, not excluded). */
  search?: string;
}

/** The `@emoji-mart/data` object, the same one passed to emoji-mart's `Picker` or `init`. */
export interface EmojiMartData {
  emojis: Record<string, EmojiMartEmoji>;
}

/** What emoji-mart passes to `onEmojiSelect` (its `getEmojiData`). */
export interface EmojiMartSelection {
  id: string;
  name: string;
  native: string;
  unified: string;
  keywords: string[];
  shortcodes: string;
  /** 1–6, present when the emoji has skin tones. */
  skin?: number;
  src?: string;
  aliases?: string[];
  emoticons?: string[];
}

const VARIATION_SELECTOR = 0xfe0f;

/**
 * Comparable key for a code point sequence. Emojibase writes "0023-FE0F-20E3" and emoji-mart
 * "23-fe0f-20e3" for the same keycap, and they disagree on where U+FE0F goes, so both sides drop
 * it and the leading zeros.
 */
export function codepointKey(hexcode: string): string {
  return hexcode
    .split("-")
    .map((part) => Number.parseInt(part, 16))
    .filter((codepoint) => codepoint !== VARIATION_SELECTOR)
    .map((codepoint) => codepoint.toString(16).toUpperCase())
    .join("-");
}

export interface EmojiMartIndex {
  /** The emoji-mart emoji for an Emojisense hexcode, if emoji-mart's data has it. */
  get(hexcode: string): EmojiMartEmoji | undefined;
  /** A filter for the emoji emoji-mart's picker lists. It passes everything until `init` has run. */
  listed(): (emoji: EmojiMartEmoji) => boolean;
}

/** Map Emojisense ids (Emojibase hexcodes) to emoji-mart emoji, built once per data object. */
export function createEmojiMartIndex(data: EmojiMartData): EmojiMartIndex {
  const byKey = new Map<string, EmojiMartEmoji>();
  for (const emoji of Object.values(data.emojis)) {
    const base = emoji.skins[0];
    if (base) byKey.set(codepointKey(base.unified), emoji);
  }
  let initialized = false;
  return {
    get: (hexcode) => byKey.get(codepointKey(hexcode)),
    listed() {
      initialized ||= Object.values(data.emojis).some((emoji) => typeof emoji.search === "string");
      return initialized ? (emoji) => typeof emoji.search === "string" : () => true;
    },
  };
}

/**
 * Emojisense results as emoji-mart emoji, best first. Results that emoji-mart's data does not
 * have (newer than its Emoji version) or that its picker hides are dropped.
 */
export function toEmojiMart(results: readonly SearchResult[], index: EmojiMartIndex): EmojiMartEmoji[] {
  const listed = index.listed();
  const seen = new Set<string>();
  const emojis: EmojiMartEmoji[] = [];
  for (const result of results) {
    const emoji = index.get(result.id);
    if (!emoji || seen.has(emoji.id) || !listed(emoji)) continue;
    seen.add(emoji.id);
    emojis.push(emoji);
  }
  return emojis;
}

/** The `onEmojiSelect` payload emoji-mart builds for this emoji and skin (1–6). */
export function toSelection(emoji: EmojiMartEmoji, skin = 1): EmojiMartSelection {
  const skinIndex = emoji.skins[skin - 1] ? skin - 1 : 0;
  const chosen = emoji.skins[skinIndex] as EmojiMartSkin;
  const selection: EmojiMartSelection = {
    id: emoji.id,
    name: emoji.name,
    native: chosen.native,
    unified: chosen.unified,
    keywords: emoji.keywords,
    // emoji-mart's init writes the same string; computing it keeps uninitialized data usable.
    shortcodes: chosen.shortcodes ?? `:${emoji.id}:${skinIndex > 0 ? `:skin-tone-${skinIndex + 1}:` : ""}`,
  };
  if (emoji.skins.length > 1) selection.skin = skinIndex + 1;
  if (chosen.src) selection.src = chosen.src;
  if (emoji.aliases?.length) selection.aliases = emoji.aliases;
  if (emoji.emoticons?.length) selection.emoticons = emoji.emoticons;
  return selection;
}
