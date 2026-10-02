import type { SessionState } from "emojisense";

/**
 * Words the playground shows for unsure queries (English only, like the playground). The hero
 * takes the translated one from its catalog: `hero.unsure` in src/i18n/<locale>.json.
 */
export const SEARCH_COPY = {
  unsure: "No strong match — try another word",
} as const;

/** How the demos show a session's answer: as a match, or as guesses. */
export interface Honesty {
  /** No tier understood the query: dim the tiles, say so. */
  guessing: boolean;
}

export function honestyOf(state: SessionState | undefined, query: string): Honesty {
  // While a request is on its way the verdict is the dictionary's alone and changes on every
  // keystroke: wait for the answer, so the tiles do not flicker while someone types.
  if (!state || !query.trim() || state.status === "idle" || state.status === "loading") {
    return { guessing: false };
  }
  return { guessing: state.unsure };
}
