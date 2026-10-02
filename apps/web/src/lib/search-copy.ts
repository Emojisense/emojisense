import type { SessionState } from "emojisense";

/**
 * Words the playground shows for unsure queries and concept answers (English only, like the
 * playground). The hero takes the translated ones from its catalog: `hero.unsure` and
 * `hero.understoodAs` in src/i18n/<locale>.json.
 */
export const SEARCH_COPY = {
  unsure: "No strong match — try another word",
  understoodAs: "understood as",
} as const;

/** How the demos show a session's answer: as guesses, or with the concept tier's reading. */
export interface Honesty {
  /** No tier understood the query and no concept answer came: dim the tiles, say so. */
  guessing: boolean;
  /** "Understood as" terms of a concept answer (catalog phrases), else empty. */
  terms: string[];
}

export function honestyOf(state: SessionState | undefined, query: string): Honesty {
  if (!state || !query.trim() || state.status === "idle") return { guessing: false, terms: [] };
  const answered = state.concept?.status === "ok";
  return {
    guessing: state.unsure && !answered,
    terms: answered ? (state.concept?.terms ?? []) : [],
  };
}
