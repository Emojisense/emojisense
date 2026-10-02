/**
 * Failure types of held-out misses. Aggregate only: the diagnosis names a type per miss and
 * counts types per locale and mode. It never writes query text, so the held-out set stays
 * held out (DECISIONS.md, 2026-10-02 quality diagnosis).
 */
import { localeInfo } from "@emojisense/data/locales";
import { normalize, type Pack, ROW_INDEX, tokenize } from "emojisense";
import { stripVariation } from "./queries.ts";

export type DiagnosisMode = "alias" | "fused" | "gated";

/** First matching type wins, in this order: label side, ranking, query form, vocabulary. */
export const FAILURE_TYPES = [
  "emoji-in-query",
  "gendered-label",
  "disputed-label",
  "gate-skipped",
  "fusion-dropped-alias",
  "fusion-dropped-semantic",
  "romanized",
  "unsegmented-script",
  "no-match",
  "unknown-word",
  "exact-phrase-other-emoji",
  "phrase-partial",
  "word-sense",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export const FAILURE_DESCRIPTIONS: Record<FailureType, string> = {
  "emoji-in-query": "The query text holds an emoji (a generator flaw; the alias engine drops it).",
  "gendered-label": "A hit once ♂/♀ variants count as their gender-neutral base.",
  "disputed-label": "The label is listed in queries/heldout-review.md (wrong, missing or ambiguous).",
  "gate-skipped": "The gate did not call the semantic tier, and fusion would have found a label.",
  "fusion-dropped-alias": "Alias had a label in its top 5; fusion pushed it out.",
  "fusion-dropped-semantic": "Semantic had a label in its top 5 (alias did not); fusion pushed it out.",
  romanized: "A non-Latin-script locale typed in Latin letters (Hinglish, Banglish, Arabizi, translit).",
  "unsegmented-script": "A script without spaces (Han, kana, Thai) whose run is not one indexed token.",
  "no-match": "The alias engine returned nothing.",
  "unknown-word": "A query word is in no phrase of the loaded packs (slang, inflection, spelling).",
  "exact-phrase-other-emoji": "The query is an indexed phrase, but of other emoji than the labels.",
  "phrase-partial": "Every word is known, but no phrase covers the query: a literal reading of a part.",
  "word-sense": "One known word; its indexed sense differs from the labels' sense.",
};

/** What the diagnosis needs to know about one query. Built by diagnose-cli.ts. */
export interface QueryEvidence {
  id: string;
  locale: string;
  /** Raw query text: read only for script and emoji tests, never printed. */
  q: string;
  answers: string[];
  /** Normalized query and its tokens, as the alias engine saw them. */
  normalized: string;
  tokens: string[];
  /** Tokens that occur in no phrase of the packs this locale loads. */
  unknownTokens: string[];
  /** Best alias phrase, when the alias engine returned anything. */
  aliasTopMatch?: string;
  /** Top 10 per list. */
  lists: { alias: string[]; semantic?: string[]; fused?: string[]; gated?: string[] };
  /** The gate (shouldUseSemantic) asked for the semantic tier. */
  gateCalled: boolean;
  /** Listed in queries/heldout-review.md. */
  disputed: boolean;
}

/** 1-based rank of the first label in the list, 0 when none; `fold` maps both sides first. */
export function rankOf(list: readonly string[], answers: readonly string[], fold = stripVariation): number {
  const wanted = new Set(answers.map(fold));
  return list.findIndex((emoji) => wanted.has(fold(emoji))) + 1;
}

const GENDER_SIGN = /‍[♀♂]/g;
/** 🤦‍♂️ and 🤦‍♀️ → 🤦: the neutral base a picker shows first. */
export const foldGender = (emoji: string) => stripVariation(emoji).replace(GENDER_SIGN, "");

const hit = (rank: number | undefined) => rank !== undefined && rank > 0 && rank <= 5;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const UNSEGMENTED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const LETTER = /\p{L}/u;
const NON_LATIN_LETTER = /[^\p{Script=Latin}\P{L}]/u;

/** A locale with a non-Latin script that people also type in Latin letters, typed in Latin. */
export function isRomanized(locale: string, q: string): boolean {
  return localeInfo(locale).romanized !== undefined && LETTER.test(q) && !NON_LATIN_LETTER.test(q);
}

/**
 * The failure type of one query in one mode, or undefined when the mode has a label in its top 5.
 * Modes without a list (no vectors) are not diagnosed.
 */
export function classifyMiss(e: QueryEvidence, mode: DiagnosisMode): FailureType | undefined {
  const list = e.lists[mode];
  if (!list) return undefined;
  if (hit(rankOf(list, e.answers))) return undefined;

  if (PICTOGRAPH.test(e.q)) return "emoji-in-query";
  if (hit(rankOf(list, e.answers, foldGender))) return "gendered-label";
  if (e.disputed) return "disputed-label";

  const aliasHit = hit(rankOf(e.lists.alias, e.answers));
  if (mode !== "alias") {
    const fusedHit = e.lists.fused !== undefined && hit(rankOf(e.lists.fused, e.answers));
    if (mode === "gated" && !e.gateCalled && fusedHit) return "gate-skipped";
    if (aliasHit) return "fusion-dropped-alias";
    if (e.lists.semantic && hit(rankOf(e.lists.semantic, e.answers))) return "fusion-dropped-semantic";
  }

  if (isRomanized(e.locale, e.q)) return "romanized";
  if (e.unknownTokens.some((t) => UNSEGMENTED.test(t))) return "unsegmented-script";
  if (e.aliasTopMatch === undefined) return "no-match";
  if (e.unknownTokens.length > 0) return "unknown-word";
  if (e.aliasTopMatch === e.normalized) return "exact-phrase-other-emoji";
  return e.tokens.length >= 2 ? "phrase-partial" : "word-sense";
}

/** Every token of every phrase (label and all phrase fields) of the packs. */
export function vocabularyOf(packs: readonly Pack[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const pack of packs) {
    for (const row of pack.emoji) {
      const fields = [normalize(row[ROW_INDEX.label]), ...row.slice(ROW_INDEX.shortcode)] as string[];
      for (const phrase of fields.flatMap((f) => (f ? f.split("|") : []))) {
        for (const token of tokenize(phrase)) vocabulary.add(token);
      }
    }
  }
  return vocabulary;
}

/** Query ids named in heldout-review.md, ranges included ("held-ar-006 to held-ar-011", "held-zh-068 to 073"). */
export function parseReviewIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const [, locale, from, to] of markdown.matchAll(
    /held-([a-z]{2})-(\d{3})(?: to (?:held-[a-z]{2}-)?(\d{3}))?/g,
  )) {
    for (let n = Number(from); n <= Number(to ?? from); n++) {
      ids.add(`held-${locale}-${String(n).padStart(3, "0")}`);
    }
  }
  return ids;
}

export type TypeCounts = Record<FailureType, Record<string, number>>;

/** Counts per type and locale, with an "all" column. */
export function countFailures(evidence: readonly QueryEvidence[], mode: DiagnosisMode): TypeCounts {
  const counts = Object.fromEntries(
    FAILURE_TYPES.map((t) => [t, {} as Record<string, number>]),
  ) as TypeCounts;
  for (const e of evidence) {
    const type = classifyMiss(e, mode);
    if (!type) continue;
    const row = counts[type];
    row[e.locale] = (row[e.locale] ?? 0) + 1;
    row.all = (row.all ?? 0) + 1;
  }
  return counts;
}

/** A markdown table: one row per type that occurs, one column per locale, then "all". */
export function renderCounts(counts: TypeCounts, locales: readonly string[], misses: Record<string, number>) {
  const lines = [
    `| Type | ${locales.join(" | ")} | all |`,
    `| --- | ${locales.map(() => "--:").join(" | ")} | --: |`,
  ];
  for (const type of FAILURE_TYPES) {
    const row = counts[type];
    if (!row.all) continue;
    lines.push(`| ${type} | ${locales.map((l) => row[l] ?? 0).join(" | ")} | ${row.all} |`);
  }
  lines.push(`| **misses** | ${locales.map((l) => misses[l] ?? 0).join(" | ")} | ${misses.all ?? 0} |`);
  return lines.join("\n");
}
