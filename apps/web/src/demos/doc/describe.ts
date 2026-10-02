import { type AliasEngine, type AliasResult, normalize, type ResultSource } from "emojisense";

export interface EmojiDescription {
  /** Display label in the page's language (English when the pack has none), e.g. "rocket". */
  label: string;
  /** A `:code:` this editor turns into the emoji (an exact shortcode or the English name). */
  code: string;
  /** Why the engine suggested it, e.g. “dumpster fire”. Undefined for a plain name match. */
  why: string | undefined;
}

export interface DescribeWords {
  similar: string;
  custom: string;
}

/**
 * How one result is shown. The engine has no "shortcode of an emoji" lookup, so the code is the
 * shortcode that matched, or else the normalized English name: both complete as `:code:` here,
 * whatever the page's language.
 */
export function describeEmoji(
  engine: AliasEngine,
  id: string,
  source: ResultSource,
  match: AliasResult | undefined,
  words: DescribeWords = { similar: "similar meaning", custom: "custom emoji" },
  locale = "en",
): EmojiDescription {
  const labels = engine.get(id)?.labels;
  const english = labels?.en ?? "";
  const label = labels?.[locale] ?? english;
  const phrase = match?.field === "shortcode" ? match.match : normalize(english);
  const code = phrase.replaceAll(" ", "_");
  let why: string | undefined;
  if (source === "semantic") why = words.similar;
  else if (source === "custom") why = words.custom;
  else if (match && match.match !== phrase) why = `“${match.match}”`;
  return { label, code, why };
}

/** Alias matches for a query, by emoji id, to explain each row. */
export function matchesFor(engine: AliasEngine, query: string, locale = "en"): Map<string, AliasResult> {
  const { results } = engine.search(query, { limit: 24, locale, culture: false });
  return new Map(results.map((result) => [result.id, result]));
}
