/**
 * Glyph documents: short texts that hold the emoji itself, so the embedding model's own sense of
 * the glyph (learned from web text full of emoji: 💀 = "I'm dead", 🐐 = "greatest of all time")
 * joins the semantic tier. They are embedded into `vectors.<model>.<dims>.glyph.bin`, a
 * multi-vector file with several rows per emoji (PACK_FORMAT.md §5, "Glyph file").
 *
 *   glyph     the bare glyph, fully qualified ("☠️")
 *   glyph-text the glyph without U+FE0F ("☠"), only where it differs
 *   name      glyph + English label ("💀 skull")
 *   context   a short usage line per strong phrase: "<phrase> <glyph>" ("im dead 💀"); phrases
 *             come from the enrichment's top, intent and slang lists that survived validation
 *   phrase    the same phrases without the glyph (a control: what the glyph itself adds)
 *
 * A gender or skin-tone variant (🤦‍♂️, a base + ZWJ + ♂/♀) inherits the texts of its base
 * emoji (🤦) when `inherit` is on: the model sees the variant as its base plus noise.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "emojisense";
import { COMBINED_LOCALES } from "./locales.ts";
import type { BaseEmoji, EnrichmentRecord, LocaleEnrichment, LocaleRecord } from "./types.ts";

export const GLYPH_KINDS = ["glyph", "glyph-text", "name", "context", "phrase"] as const;
export type GlyphKind = (typeof GLYPH_KINDS)[number];

export interface GlyphText {
  hexcode: string;
  kind: GlyphKind;
  /** Locale of the phrase (`context`, `phrase`); absent for language-free texts. */
  locale?: string;
  text: string;
}

export interface GlyphOptions {
  kinds: readonly GlyphKind[];
  /** Locales whose phrases make `context` and `phrase` texts. Default: English. */
  locales?: readonly string[];
  /** Phrases per emoji and locale. */
  contexts?: number;
  /** Variants reuse their base emoji's texts. */
  inherit?: boolean;
}

/** Phrase lists per locale and hexcode, from the enrichment files (top, intent, slang, synonym). */
export type PhraseSource = Map<string, Map<string, LocaleEnrichment>>;

/** Validated aliases per hexcode and locale (build/validated.json); only these may be used. */
export type ValidatedAliases = Record<string, Record<string, { alias: string[] } | undefined>>;

export const DEFAULT_CONTEXTS = 3;

const VARIATION_SELECTOR = /️/g;
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const GENDER_SUFFIX = /‍[♀♂]️?$/u;

/** The base glyph of a gender or skin-tone variant ("🤦‍♂️" → "🤦"); the glyph itself otherwise. */
export function glyphBase(glyph: string): string {
  return glyph.replace(SKIN_TONE, "").replace(GENDER_SUFFIX, "");
}

/**
 * The strongest usage phrases of one emoji in one locale: top, then intent, slang and synonyms.
 * A phrase counts only when its normalized form is still a validated alias (curation removed or
 * demoted the others).
 */
export function usagePhrases(block: LocaleEnrichment | undefined, allowed: readonly string[], n: number) {
  if (!block) return [];
  const allowedSet = new Set(allowed);
  const demoted = new Set(block.low.map((p) => normalize(p)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phrase of [...(block.top ?? []), ...block.intent, ...block.slang, ...block.synonym]) {
    const key = normalize(phrase);
    if (!key || seen.has(key) || demoted.has(key) || !allowedSet.has(key)) continue;
    seen.add(key);
    // As written (accents, apostrophes): the model reads them; folding costs recall (DECISIONS.md).
    out.push(phrase.trim());
    if (out.length >= n) break;
  }
  return out;
}

export function buildGlyphTexts(
  emoji: readonly BaseEmoji[],
  phrases: PhraseSource,
  validated: ValidatedAliases,
  options: GlyphOptions,
): GlyphText[] {
  const { kinds, locales = ["en"], contexts = DEFAULT_CONTEXTS, inherit = true } = options;
  const byGlyph = new Map(emoji.map((e) => [e.emoji, e]));
  const out: GlyphText[] = [];
  for (const e of emoji) {
    const base = (inherit && byGlyph.get(glyphBase(e.emoji))) || e;
    const glyph = base.emoji;
    const add = (kind: GlyphKind, text: string, locale?: string) => {
      if (kinds.includes(kind)) out.push({ hexcode: e.hexcode, kind, text, ...(locale ? { locale } : {}) });
    };
    add("glyph", glyph);
    const plain = glyph.replace(VARIATION_SELECTOR, "");
    if (plain !== glyph) add("glyph-text", plain);
    add("name", `${glyph} ${base.label}`);
    for (const locale of locales) {
      const allowed = validated[base.hexcode]?.[locale]?.alias ?? [];
      for (const phrase of usagePhrases(phrases.get(locale)?.get(base.hexcode), allowed, contexts)) {
        add("context", `${phrase} ${glyph}`, locale);
        add("phrase", phrase, locale);
      }
    }
  }
  return out;
}

/** Read the enrichment phrase lists of `locales` (en and tr from the combined files). */
export function loadPhraseSource(
  enrichmentDir: string,
  groups: readonly string[],
  locales: readonly string[],
) {
  const source: PhraseSource = new Map(locales.map((l) => [l, new Map<string, LocaleEnrichment>()]));
  const combined = locales.filter((l) => (COMBINED_LOCALES as readonly string[]).includes(l));
  for (const group of groups) {
    if (combined.length > 0) {
      const path = join(enrichmentDir, `${group}.json`);
      if (existsSync(path)) {
        for (const r of JSON.parse(readFileSync(path, "utf8")) as EnrichmentRecord[]) {
          for (const locale of combined) {
            const block = r[locale as (typeof COMBINED_LOCALES)[number]];
            if (block) source.get(locale)?.set(r.hexcode, block);
          }
        }
      }
    }
    for (const locale of locales.filter((l) => !combined.includes(l))) {
      const path = join(enrichmentDir, "i18n", locale, `${group}.json`);
      if (!existsSync(path)) continue;
      for (const r of JSON.parse(readFileSync(path, "utf8")) as LocaleRecord[]) {
        source.get(locale)?.set(r.hexcode, r);
      }
    }
  }
  return source;
}
