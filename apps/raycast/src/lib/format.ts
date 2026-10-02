import type { AliasEngine, AliasResult, SearchResult } from "emojisense";

/** One row of the result list, independent of the Raycast UI components. */
export interface EmojiItem {
  /** Unique within one result list. */
  key: string;
  emoji: string;
  /** Emojibase hexcode of the base emoji, e.g. "1F44D" or "1F9D1-200D-1F4BB". */
  hexcode: string;
  title: string;
  /** Why the emoji matched, e.g. “jurassic park” or :thumbsup:. Empty for a match on the name. */
  subtitle: string;
  /** Short tag for the kind of match. */
  kind: MatchKind;
}

export type MatchKind =
  | "name"
  | "shortcode"
  | "keyword"
  | "alias"
  | "typo"
  | "related"
  | "semantic"
  | "custom";

const KIND_BY_FIELD: Record<AliasResult["field"], MatchKind> = {
  name: "name",
  shortcode: "shortcode",
  keyword: "keyword",
  alias: "alias",
  typo: "typo",
  low: "related",
};

type AnyResult = SearchResult | AliasResult;

function isAlias(result: AnyResult): result is AliasResult {
  return result.source === "alias" && "field" in result;
}

/** The phrase that made an emoji match, in the form people type it. */
export function whyMatched(result: AnyResult): { subtitle: string; kind: MatchKind } {
  if (!isAlias(result)) {
    return result.source === "custom"
      ? { subtitle: "custom emoji", kind: "custom" }
      : { subtitle: "similar meaning", kind: "semantic" };
  }
  const kind = KIND_BY_FIELD[result.field];
  if (kind === "name") return { subtitle: "", kind };
  // Shortcodes are stored normalized ("thumbs up"); show them the way they are typed.
  if (kind === "shortcode") return { subtitle: `:${result.match.replaceAll(" ", "_")}:`, kind };
  return { subtitle: `“${result.match}”`, kind };
}

/** Display label in the chosen locale. Semantic results carry no label, so it comes from the pack. */
export function labelFor(engine: AliasEngine, result: AnyResult, locale: string): string {
  if (isAlias(result) && result.label) return result.label;
  const labels = engine.get(result.id)?.labels ?? {};
  return labels[locale] ?? labels[engine.locales[0] ?? "en"] ?? result.id;
}

export function toEmojiItem(engine: AliasEngine, result: AnyResult, locale: string): EmojiItem {
  return {
    key: `${result.id}:${result.source}`,
    emoji: result.emoji || engine.get(result.id)?.emoji || "",
    hexcode: result.id,
    title: labelFor(engine, result, locale),
    ...whyMatched(result),
  };
}
