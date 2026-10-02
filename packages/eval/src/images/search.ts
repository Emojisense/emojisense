import { type AliasEngine, fuse, normalize, type SearchResult, tokenize } from "emojisense";
import type { Caption } from "./captioners.ts";

/** Semantic results for a text, or undefined when the semantic layer is not available. */
export type SemanticSearch = (text: string) => SearchResult[] | undefined;

const CANDIDATES = 24;
const RRF_K = 60;
/** Single caption words count half: they rescue long captions but must not outvote the texts. */
const WORD_WEIGHT = 0.5;
const FILLER = new Set("a an the of on in at to and with is are its this that some two three".split(" "));

/**
 * Image → emoji v1: search the reaction and the caption like typed queries (alias + semantic,
 * fused as on the Worker) and merge the lists by reciprocal rank, so the top holds both "what it
 * shows" (🐶) and "how people react" (🥹). A whole caption rarely matches an alias phrase
 * ("a puppy asleep on a sofa"), so its content words are searched one by one as well.
 */
export function rankForCaption(
  engine: AliasEngine,
  { caption, reaction }: Caption,
  semantic?: SemanticSearch,
  limit = 10,
): string[] {
  const search = (text: string): SearchResult[] => {
    // A caption is a finished text, not a word being typed: no prefix matching.
    const alias = engine.search(text, { prefix: false, limit: CANDIDATES });
    const semanticResults = semantic?.(text);
    return semanticResults ? fuse(alias, semanticResults, CANDIDATES) : alias.results;
  };
  const words = tokenize(normalize(caption)).filter((w) => w.length >= 3 && !FILLER.has(w));
  const lists: [SearchResult[], number][] = [
    ...[reaction, caption]
      .filter((t) => normalize(t) !== "")
      .map((t): [SearchResult[], number] => [search(t), 1]),
    ...(words.length > 1 ? words : []).map((w): [SearchResult[], number] => [
      engine.search(w, { prefix: false, limit: CANDIDATES }).results,
      WORD_WEIGHT,
    ]),
  ];

  const scores = new Map<string, { emoji: string; score: number }>();
  for (const [results, weight] of lists) {
    results.forEach((r, rank) => {
      const entry = scores.get(r.id) ?? { emoji: r.emoji, score: 0 };
      entry.score += weight / (RRF_K + rank + 1);
      scores.set(r.id, entry);
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.emoji);
}
