import { type AliasEngine, type AliasResult, normalize, type ResultSource } from "emojisense";

export interface EmojiDescription {
  /** English display label from the pack, e.g. "rocket". */
  label: string;
  /** A `:code:` this editor turns into the emoji (an exact shortcode or name). */
  code: string;
  /** Why the engine suggested it, e.g. “dumpster fire”. Undefined for a plain name match. */
  why: string | undefined;
}

/**
 * How one result is shown. The engine has no "shortcode of an emoji" lookup, so the code is the
 * shortcode that matched, or else the normalized English name: both complete as `:code:` here.
 */
export function describeEmoji(
  engine: AliasEngine,
  id: string,
  source: ResultSource,
  match: AliasResult | undefined,
): EmojiDescription {
  const label = engine.get(id)?.labels.en ?? "";
  const phrase = match?.field === "shortcode" ? match.match : normalize(label);
  const code = phrase.replaceAll(" ", "_");
  let why: string | undefined;
  if (source === "semantic") why = "similar meaning";
  else if (source === "custom") why = "custom emoji";
  else if (match && match.match !== phrase) why = `“${match.match}”`;
  return { label, code, why };
}

/** Alias matches for a query, by emoji id, to explain each row. */
export function matchesFor(engine: AliasEngine, query: string): Map<string, AliasResult> {
  const { results } = engine.search(query, { limit: 24, locale: "en", culture: false });
  return new Map(results.map((result) => [result.id, result]));
}
