import type { AliasEngine, SearchResult } from "emojisense";

/** One emoji in a tool result. The same shape for all three tools. */
export interface EmojiSuggestion {
  emoji: string;
  /** Emojibase hexcode of the base emoji, e.g. "1F680". */
  id: string;
  label: string;
  /** 0–1. Comparable within one result list only. */
  score: number;
  /**
   * "alias" = on-device dictionary, "semantic" = Emojisense API, "default" = a generic reaction
   * added because the text matched too little.
   */
  source: SearchResult["source"] | "default";
  /** The alias phrase that matched ("why this emoji"). */
  match?: string;
  /** The part of the input text that matched (text tools only). */
  window?: string;
}

/** Display label in the preferred locale, falling back to the pack's first locale. */
export function labelFor(engine: AliasEngine, id: string, locale?: string): string {
  const labels = engine.get(id)?.labels ?? {};
  return labels[locale ?? ""] ?? labels[engine.locales[0] ?? "en"] ?? "";
}

/**
 * Convert an engine or API result. API results carry no label or alias phrase, so the label comes
 * from the local pack.
 */
export function toSuggestion(
  engine: AliasEngine,
  result: SearchResult & { label?: string; match?: string; window?: string },
  locale?: string,
): EmojiSuggestion {
  const label = result.label || labelFor(engine, result.id, locale);
  return {
    emoji: result.emoji || engine.get(result.id)?.emoji || "",
    id: result.id,
    label,
    score: result.score,
    source: result.source,
    ...(result.match ? { match: result.match } : {}),
    ...(result.window ? { window: result.window } : {}),
  };
}
