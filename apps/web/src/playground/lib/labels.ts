import type { AliasResult, SearchResult } from "emojisense";

/** Where a result came from, in the words the playground uses everywhere. */
export const SOURCE_NAMES: Record<SearchResult["source"], string> = {
  alias: "Dictionary",
  semantic: "Meaning",
  custom: "Custom",
  culture: "Culture",
  concept: "Concept",
};

/** The pack field that held the matching phrase (PACK_FORMAT.md). */
export const FIELD_NAMES: Record<AliasResult["field"], string> = {
  name: "name",
  shortcode: "shortcode",
  keyword: "keyword",
  alias: "alias",
  typo: "typo",
  low: "weak alias",
};
