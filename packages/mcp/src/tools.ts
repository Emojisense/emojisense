import {
  type AliasEngine,
  fuse,
  fuseResults,
  normalize,
  type SearchResult,
  shouldUseSemantic,
} from "emojisense";
import type { EmojisenseApi } from "./api.js";
import { suggestReactionsOffline } from "./reactions.js";
import { type EmojiSuggestion, toSuggestions } from "./suggestion.js";
import { matchText } from "./text.js";

export interface ToolDeps {
  engine: AliasEngine;
  /** Optional semantic layer. Without it, every tool answers from the bundled packs only. */
  api?: EmojisenseApi | undefined;
}

/** What a handler returns: short text for the model plus the same data as structured content. */
export interface ToolOutput<T> {
  text: string;
  structured: T;
}

export const DEFAULT_LIMITS = { search: 10, forText: 5, reactions: 6 } as const;

export type SearchEmojiInput = { query: string; locale?: string | undefined; limit?: number | undefined };
export type SearchEmojiOutput = {
  /** The normalized query. */
  query: string;
  locale: string;
  /** True when results from the Emojisense API were merged in. */
  semantic: boolean;
  results: EmojiSuggestion[];
};

export type TextInput = { text: string; locale?: string | undefined; limit?: number | undefined };
export type EmojiForTextOutput = {
  /** The text with the best emoji appended, or the text unchanged when nothing matched. */
  suggestion: string;
  semantic: boolean;
  results: EmojiSuggestion[];
};
export type SuggestReactionsOutput = { semantic: boolean; results: EmojiSuggestion[] };

export async function searchEmoji(
  deps: ToolDeps,
  input: SearchEmojiInput,
): Promise<ToolOutput<SearchEmojiOutput>> {
  const { engine, api } = deps;
  const locale = input.locale ?? defaultLocale(engine);
  const limit = input.limit ?? DEFAULT_LIMITS.search;
  // The model sends finished queries, so the last word is not a prefix and may get typo correction.
  const alias = engine.search(input.query, { limit, locale, prefix: false });
  // Same rule as the client SDK: only unsure or conceptual queries reach the (metered) API.
  const semantic =
    api && shouldUseSemantic(alias) ? await api.search(input.query, { locale, limit }) : undefined;
  const fused = semantic && fuse(alias, semantic, limit, undefined, { popularity: engine.popularity });
  const results = toSuggestions(engine, fused || alias.results, locale);
  const text = results.length > 0 ? results.map(describe).join("\n") : `No emoji found for "${input.query}".`;
  return { text, structured: { query: alias.query, locale, semantic: Boolean(semantic), results } };
}

export async function emojiForText(
  deps: ToolDeps,
  input: TextInput,
): Promise<ToolOutput<EmojiForTextOutput>> {
  const { engine, api } = deps;
  const locale = input.locale ?? defaultLocale(engine);
  const limit = input.limit ?? DEFAULT_LIMITS.forText;
  const local = matchText(engine, input.text, { locale, limit: Math.max(limit, 10) });
  // Message text goes to suggest-reactions, never to search: the search endpoint logs query text.
  const semantic = api ? await api.suggestReactions(input.text, { locale, limit }) : undefined;
  const merged: SearchResult[] = semantic ? fuseLocal(local, semantic, limit) : local.slice(0, limit);
  const results = toSuggestions(engine, merged, locale);
  const best = results[0];
  const suggestion = best ? `${input.text.trimEnd()} ${best.emoji}` : input.text;
  const text = best
    ? [`Suggested: ${suggestion}`, ...results.map(describe)].join("\n")
    : "No emoji matched this text.";
  return { text, structured: { suggestion, semantic: Boolean(semantic), results } };
}

export async function suggestReactions(
  deps: ToolDeps,
  input: TextInput,
): Promise<ToolOutput<SuggestReactionsOutput>> {
  const { engine, api } = deps;
  const locale = input.locale ?? defaultLocale(engine);
  const limit = input.limit ?? DEFAULT_LIMITS.reactions;
  const local = suggestReactionsOffline(engine, input.text, { locale, limit });
  const semantic = api ? await api.suggestReactions(input.text, { locale, limit }) : undefined;

  let results = local;
  if (semantic) {
    const matched = local.filter(isMatched);
    const fused = toSuggestions(engine, fuseLocal(matched, semantic, limit), locale);
    // Generic fallbacks (👍 ❤️) only fill places the matches and the API left empty.
    const fillers = local.filter((r) => !isMatched(r) && !fused.some((f) => f.id === r.id));
    results = [...fused, ...fillers].slice(0, limit);
  }
  const text =
    results.length > 0 ? results.map((r) => `${r.emoji} ${r.label}`).join(", ") : "No reactions found.";
  return { text, structured: { semantic: Boolean(semantic), results } };
}

/** Confident local matches stay on top; the rest is merged by rank with the API results. */
function fuseLocal(local: readonly SearchResult[], semantic: readonly SearchResult[], limit: number) {
  return fuseResults(local, semantic, {
    limit,
    aliasWeight: 0.4 + (local[0]?.score ?? 0),
    semanticWeight: 1,
  });
}

function isMatched(result: EmojiSuggestion): result is EmojiSuggestion & SearchResult {
  return result.source !== "default";
}

function defaultLocale(engine: AliasEngine): string {
  return engine.locales[0] ?? "en";
}

/** "🦖 T-Rex — jurassic park": the emoji, its name, and why it matched. */
function describe(result: EmojiSuggestion): string {
  const why = result.source === "semantic" ? "semantic match" : result.match;
  // Alias phrases are normalized; a match on the label itself adds nothing.
  return why && why !== normalize(result.label)
    ? `${result.emoji} ${result.label} — ${why}`
    : `${result.emoji} ${result.label}`;
}
