/**
 * The search fields of one emoji in one locale's pack rows (build-pack.ts): the CLDR label and
 * keywords (English: Emojibase), the validated aliases, typos and low phrases, and the curation
 * decisions on the keywords (curation.ts). The label is never curated.
 */
import { normalize } from "emojisense";
import { type Curation, curateKeywords } from "./curation.ts";
import type { BaseEmoji } from "./types.ts";
import type { ValidatedLocale } from "./validate.ts";

/** Field values, normalized and joined with "|". `alias` is the core part's share of the aliases. */
export interface PackFields {
  label: string;
  shortcode: string;
  keyword: string;
  alias: string;
  typo: string;
  low: string;
  /** The aliases after the first `coreAliasCount`, for the ext part. */
  extAlias: string;
}

/** The CLDR keywords of an emoji in a locale; English keywords are the Emojibase tags. */
export const cldrKeywords = (e: BaseEmoji, locale: string): string[] =>
  locale === "en" ? e.tags : (e.i18n[locale]?.tags ?? []);

/** Normalize, drop phrases already present in a stronger field, join with "|". */
function joinFields(lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  return lists.map((list) =>
    list
      .map((s) => normalize(s))
      .filter((s) => s !== "" && !seen.has(s) && seen.add(s))
      .join("|"),
  );
}

export function packFields(
  e: BaseEmoji,
  locale: string,
  validated: ValidatedLocale | undefined,
  coreAliasCount: number,
  curations: readonly Curation[],
): PackFields {
  const label = locale === "en" ? e.label : (e.i18n[locale]?.label ?? e.label);
  const aliases = validated?.alias ?? [];
  const keywords = curateKeywords(curations, e.hexcode, locale, cldrKeywords(e, locale));
  const [, shortcode = "", keyword = "", alias = "", typo = "", low = "", extAlias = ""] = joinFields([
    [label],
    locale === "en" ? e.shortcodes : [],
    keywords.keyword,
    aliases.slice(0, coreAliasCount),
    validated?.typo ?? [],
    [...keywords.low, ...(validated?.low ?? [])],
    aliases.slice(coreAliasCount),
  ]);
  return { label, shortcode, keyword, alias, typo, low, extAlias };
}
