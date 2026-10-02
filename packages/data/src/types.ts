export interface BaseEmoji {
  hexcode: string;
  emoji: string;
  label: string;
  tags: string[];
  shortcodes: string[];
  group: string;
  subgroup: string;
  order: number;
  version: number;
  /** Hexcodes of skin-tone variants; search maps them to this base emoji. */
  skins: string[];
  /** CLDR label + keywords per non-English locale (src/locales.ts). */
  i18n: Record<string, { label: string | null; tags: string[] }>;
}

export const ALIAS_CATEGORIES = ["synonym", "slang", "pop_culture", "dev", "typo", "intent"] as const;
export type AliasCategory = (typeof ALIAS_CATEGORIES)[number];

export type LocaleEnrichment = {
  desc: string;
  low: string[];
  /** Optional: the 1–3 strongest real-world phrases, placed before every category (alias-order.ts). */
  top?: string[];
} & Record<AliasCategory, string[]>;

/** One record per emoji and locale in enrichment/i18n/<locale>/<group>.json. */
export interface LocaleRecord extends LocaleEnrichment {
  hexcode: string;
  emoji: string;
}

/** One record per base emoji (en + tr), written by the enrichment step (LLM or hand-curated). */
export interface EnrichmentRecord {
  hexcode: string;
  emoji: string;
  en: LocaleEnrichment;
  tr: LocaleEnrichment;
}

/**
 * Aliases mined from real low-confidence queries (Tier 3), kept apart from the curated
 * enrichment for provenance. File: enrichment/mined.json.
 */
export interface MinedAlias {
  hexcode: string;
  locale: string;
  alias: string;
  /** Times the query was seen (aggregated, ≥ the k-anonymity threshold). */
  count: number;
  minedAt: string;
}
