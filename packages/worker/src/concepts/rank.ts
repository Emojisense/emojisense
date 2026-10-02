import { type AliasEngine, normalize, type SearchResult } from "emojisense";
import { fuseLists, type WeightedList } from "../fusion.ts";
import { MAX_CONCEPT_RESULTS, MAX_DISPLAY_TERMS } from "./config.ts";
import type { ConceptAnswer } from "./model.ts";

/**
 * Evidence weights for a concept answer (DECISIONS.md, "Concept tier for unsure queries"). The
 * model's own emoji count most; an alias hit of a concept term is precise; the semantic
 * neighbours of the terms have the best recall and the weakest top.
 */
export const CONCEPT_WEIGHTS = { proposed: 1, term: 0.5, neighbours: 0.5 } as const;
/** RRF constant: rank 8 of a list still adds 56 % of its weight. */
const RRF_K = 8;
/**
 * Evidence an emoji needs. Any model proposal passes (≥ 0.56); on its own, only an exact term hit
 * at rank 1 or the top neighbour does; weaker single-list emoji need a second source.
 */
export const CONCEPT_FLOOR = 0.46;
const TERM_CANDIDATES = 6;
/** Fuzzy or partial alias hits of a term are noise ("rapper" → 🎁 via "wrapper"). */
const MIN_TERM_SCORE = 0.5;

export interface RankedConcept {
  /** `source: "concept"`, best first. */
  results: SearchResult[];
  /** Concept terms that are phrases of the catalog, for "understood as". Never model text. */
  display: string[];
}

/** The text whose embedding gives the semantic neighbours of an answer. */
export function neighbourText(answer: ConceptAnswer): string {
  return answer.terms.slice(0, 4).join(", ");
}

/**
 * Concept answer → emoji: fuse the model's emoji (checked against the catalog), an English alias
 * search per term (whole words) and the semantic neighbours of the terms; drop what has too
 * little evidence. Gender and direction variants keep their best member.
 */
export function rankConcept(
  engine: AliasEngine,
  answer: ConceptAnswer,
  neighbours: readonly SearchResult[] | undefined,
  limit = MAX_CONCEPT_RESULTS,
): RankedConcept {
  const proposed = answer.emoji.map(
    (id, i): SearchResult => ({
      emoji: engine.get(id)?.emoji ?? "",
      id,
      score: 1 / (i + 1),
      source: "concept",
    }),
  );
  const display: string[] = [];
  const termLists = answer.terms.map((term): WeightedList => {
    const output = engine.search(term, {
      locale: "en",
      limit: TERM_CANDIDATES,
      prefix: false,
      culture: false,
    });
    const phrase = normalize(term);
    // Shown only when the whole term is a catalog phrase: the text is ours, not the model's.
    if (display.length < MAX_DISPLAY_TERMS && output.results.some((r) => r.match === phrase)) {
      if (!display.includes(phrase)) display.push(phrase);
    }
    return {
      results: output.results.filter((r) => r.score >= MIN_TERM_SCORE),
      weight: CONCEPT_WEIGHTS.term,
      byScore: true,
    };
  });
  const lists: WeightedList[] = [
    { results: proposed, weight: CONCEPT_WEIGHTS.proposed },
    ...termLists,
    { results: neighbours ?? [], weight: CONCEPT_WEIGHTS.neighbours },
  ];
  const fused = fuseLists(lists, {
    k: RRF_K,
    limit,
    floor: CONCEPT_FLOOR,
    scale: CONCEPT_WEIGHTS.proposed + CONCEPT_WEIGHTS.term + CONCEPT_WEIGHTS.neighbours,
  });
  return {
    results: fused.map((r) => ({
      ...r,
      emoji: engine.get(r.id)?.emoji ?? r.emoji,
      source: "concept" as const,
    })),
    display,
  };
}
