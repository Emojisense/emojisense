/** Client data pack, format v1. Normative spec: docs/PACK_FORMAT.md. */

export const PACK_FORMAT = "emojisense-pack";
export const PACK_FORMAT_VERSION = 1;

/** Search fields in a pack row, in row order, strongest first. */
export const FIELDS = ["name", "shortcode", "keyword", "alias", "typo", "low"] as const;
export type Field = (typeof FIELDS)[number];

/** Default field weights. A pack may override them in `weights`. */
export const DEFAULT_WEIGHTS: Record<Field, number> = {
  name: 1,
  shortcode: 0.95,
  keyword: 0.85,
  alias: 0.8,
  typo: 0.75,
  low: 0.55,
};

/**
 * One emoji. `label` is the display label; its normalized form is the `name` field.
 * The other search fields are `|`-separated phrases that are already normalized.
 */
export type PackRow = [
  emoji: string,
  hexcode: string,
  group: number,
  version: number,
  skins: 0 | 1,
  label: string,
  shortcode: string,
  keyword: string,
  alias: string,
  typo: string,
  low: string,
];

export interface Pack {
  format: typeof PACK_FORMAT;
  formatVersion: number;
  packVersion: string;
  locale: string;
  emojiVersion: string;
  groups: string[];
  weights?: Partial<Record<Field, number>>;
  emoji: PackRow[];
}

export const ROW = {
  emoji: 0,
  hexcode: 1,
  group: 2,
  version: 3,
  skins: 4,
  label: 5,
  /** Row index of `shortcode`; the following fields keep {@link FIELDS} order. */
  shortcode: 6,
} as const;

export function assertPack(value: unknown): asserts value is Pack {
  const pack = value as Partial<Pack> | null;
  if (pack?.format !== PACK_FORMAT) throw new Error("emojisense: not an emojisense pack");
  if (pack.formatVersion !== PACK_FORMAT_VERSION) {
    throw new Error(
      `emojisense: pack format v${pack.formatVersion} is not supported (expected v${PACK_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(pack.emoji)) throw new Error("emojisense: pack has no emoji rows");
}
