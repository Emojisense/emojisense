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
  tr: { label: string | null; tags: string[] };
}

export const ALIAS_CATEGORIES = ["synonym", "slang", "pop_culture", "dev", "typo", "intent"] as const;
export type AliasCategory = (typeof ALIAS_CATEGORIES)[number];

export type LocaleEnrichment = { desc: string; low: string[] } & Record<AliasCategory, string[]>;

/** One record per base emoji, written by the enrichment step (LLM or hand-curated). */
export interface EnrichmentRecord {
  hexcode: string;
  emoji: string;
  en: LocaleEnrichment;
  tr: LocaleEnrichment;
}
