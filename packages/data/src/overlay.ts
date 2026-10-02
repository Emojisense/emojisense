/**
 * Extra aliases for a locale of the combined en + tr files, kept in their own files so two
 * writers do not edit the same record lines: enrichment/i18n/<locale>/<group>.json.
 *
 * An overlay record holds only what it adds: `hexcode`, `emoji` and any of `top`, the alias
 * categories and `low` (no `desc`). validate.ts merges it into the combined block before
 * curation, moderation, the collision cap and the core-pack fit, so an overlay phrase is treated
 * like any other alias of that locale.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { ALIAS_CATEGORIES, type AliasCategory, type LocaleEnrichment } from "./types.ts";

/** Combined-file locales that read an overlay. */
export const OVERLAY_LOCALES = ["tr"] as const;

type ListKey = "top" | AliasCategory | "low";
const LIST_KEYS: readonly ListKey[] = ["top", ...ALIAS_CATEGORIES, "low"];

export type OverlayRecord = { hexcode: string; emoji: string } & Partial<Record<ListKey, string[]>>;

/**
 * The base block with the overlay's phrases first in each list (`top` included). A base phrase
 * that the overlay lists as an alias (normalized) is dropped from the base lists, `low` included,
 * so the overlay decides its place and confidence. An overlay `low` entry demotes a base alias.
 */
export function mergeOverlay(base: LocaleEnrichment, overlay: OverlayRecord): LocaleEnrichment {
  const listed = (keys: readonly ListKey[]) =>
    new Set(keys.flatMap((key) => (overlay[key] ?? []).map((phrase) => normalize(phrase))));
  const overlayAliases = listed(LIST_KEYS.filter((key) => key !== "low"));
  const overlayLow = listed(["low"]);
  const merged = { ...base };
  for (const key of LIST_KEYS) {
    const skip = key === "low" ? new Set([...overlayAliases, ...overlayLow]) : overlayAliases;
    const rest = (base[key] ?? []).filter((phrase) => !skip.has(normalize(phrase)));
    const list = [...(overlay[key] ?? []), ...rest];
    if (key !== "top" || list.length > 0) merged[key] = list;
  }
  return merged;
}

/**
 * All overlay records of one locale, by hexcode. Fails on a malformed record, an unknown
 * hexcode or a hexcode listed twice, naming the file.
 */
export function loadOverlay(
  dir: string,
  groups: readonly string[],
  known: ReadonlySet<string>,
): Map<string, OverlayRecord> {
  const byHexcode = new Map<string, OverlayRecord>();
  for (const group of groups) {
    const path = join(dir, `${group}.json`);
    if (!existsSync(path)) continue;
    const records: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(records)) throw new Error(`${path}: top level must be an array`);
    for (const record of records as OverlayRecord[]) {
      const where = `${path}: ${record?.hexcode ?? "record without hexcode"}`;
      if (!known.has(record?.hexcode)) throw new Error(`${where}: unknown hexcode`);
      if (byHexcode.has(record.hexcode)) throw new Error(`${where}: listed twice`);
      for (const key of LIST_KEYS) {
        const list = record[key];
        if (
          list !== undefined &&
          (!Array.isArray(list) || list.some((p) => typeof p !== "string" || !p.trim()))
        ) {
          throw new Error(`${where}: "${key}" must be an array of phrases`);
        }
      }
      byHexcode.set(record.hexcode, record);
    }
  }
  return byHexcode;
}
