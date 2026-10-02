import { applySkinTone, hexcodeOf, type PackRow, ROW_INDEX, SKIN_TONES, type SkinTone } from "emojisense";

/** One emoji that a hosted set may draw: a pack row, or one of its single-tone variants. */
export interface SetEmoji {
  /** Fully qualified, as in the pack (or as `applySkinTone` makes it). */
  emoji: string;
  /** Canonical Emojibase hexcode, e.g. "1F44D-1F3FD". */
  hexcode: string;
  /** Hexcode of the pack row. */
  base: string;
  tone: SkinTone;
}

export interface SetCatalog {
  /** Accepts any case and any U+FE0F spelling of a known hexcode. */
  find(hexcode: string): SetEmoji | undefined;
  readonly all: readonly SetEmoji[];
}

/** 1–6 hex digits per code point, at most 16 code points (the longest emoji has 10). */
const HEXCODE = /^[0-9A-F]{1,6}(?:-[0-9A-F]{1,6}){0,15}$/i;
const VARIATION_SELECTOR_16 = 0xfe0f;
const MAX_CODE_POINT = 0x10ffff;

/** The code points of a hexcode such as "1f44d-1F3FD", or undefined when it is malformed. */
export function parseHexcode(raw: string): number[] | undefined {
  if (!HEXCODE.test(raw)) return undefined;
  const codePoints = raw.split("-").map((part) => Number.parseInt(part, 16));
  return codePoints.every((codePoint) => codePoint <= MAX_CODE_POINT) ? codePoints : undefined;
}

/** Lookup key: U+FE0F removed, uppercase, 4-digit minimum, so every spelling of an emoji meets. */
function keyOf(codePoints: readonly number[]): string {
  return codePoints
    .filter((codePoint) => codePoint !== VARIATION_SELECTOR_16)
    .map((codePoint) => codePoint.toString(16).toUpperCase().padStart(4, "0"))
    .join("-");
}

const codePointsOf = (emoji: string) => Array.from(emoji, (char) => char.codePointAt(0) as number);

/**
 * The emoji that the sets route serves: every pack row, plus the five variants the pickers make
 * with `applySkinTone` (one tone for every person) when the row supports skin tones.
 */
export function createSetCatalog(rows: readonly PackRow[]): SetCatalog {
  const byKey = new Map<string, SetEmoji>();
  const all: SetEmoji[] = [];
  const add = (entry: SetEmoji) => {
    byKey.set(keyOf(codePointsOf(entry.emoji)), entry);
    all.push(entry);
  };
  for (const row of rows) {
    const emoji = row[ROW_INDEX.emoji];
    const base = row[ROW_INDEX.hexcode];
    add({ emoji, hexcode: base, base, tone: "none" });
    if (row[ROW_INDEX.skins] !== 1) continue;
    for (const tone of SKIN_TONES) {
      if (tone === "none") continue;
      const variant = applySkinTone(emoji, tone);
      add({ emoji: variant, hexcode: hexcodeOf(variant), base, tone });
    }
  }
  return {
    all,
    find(hexcode) {
      const codePoints = parseHexcode(hexcode);
      return codePoints ? byKey.get(keyOf(codePoints)) : undefined;
    },
  };
}
