/**
 * Embedding documents: the text an embedding model sees per emoji, one document per pack locale.
 *
 *   title  the emoji's label in that locale (CLDR; English from Emojibase)
 *   text   the locale's description, then its CLDR keywords and its first aliases (strongest first)
 *
 * English documents go to the shared vector file, every other locale's to its own file
 * (vector-files.ts). A query searches the shared file and its locale's file (PACK_FORMAT.md §5).
 */
import type { BaseEmoji } from "./types.ts";

/** The validated aliases of one emoji in one locale (build/validated.json, strongest first). */
export interface DocumentSource {
  desc: string;
  alias: string[];
}

/** Aliases per document. Measured on the in-house and dev suites: 30 and 40 score the same. */
export const DOCUMENT_ALIASES = 40;

export interface EmbeddingDocument {
  title: string;
  text: string;
}

/** One emoji's documents, by locale. */
export interface EmojiDocuments {
  hexcode: string;
  docs: Record<string, EmbeddingDocument>;
}

export function buildDocument(
  emoji: BaseEmoji,
  locale: string,
  source: DocumentSource | undefined,
  aliases = DOCUMENT_ALIASES,
): EmbeddingDocument {
  const cldr = locale === "en" ? { label: emoji.label, tags: emoji.tags } : emoji.i18n[locale];
  const terms = [...new Set([...(cldr?.tags ?? []), ...(source?.alias ?? []).slice(0, aliases)])];
  return {
    title: cldr?.label || emoji.label,
    text: [source?.desc ?? "", terms.join(", ")].join(" ").trim(),
  };
}

export function buildDocuments(
  emoji: readonly BaseEmoji[],
  validated: Record<string, Record<string, DocumentSource>>,
  locales: readonly string[],
): EmojiDocuments[] {
  return emoji.map((e) => ({
    hexcode: e.hexcode,
    docs: Object.fromEntries(
      locales.map((locale) => [locale, buildDocument(e, locale, validated[e.hexcode]?.[locale])]),
    ),
  }));
}
