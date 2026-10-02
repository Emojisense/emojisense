import { readFileSync } from "node:fs";

export interface EvalQuery {
  id: string;
  q: string;
  /** A pack locale (`LOCALE_CODES` in @emojisense/data). The in-house suite has only en and tr. */
  locale: string;
  cat: string;
  /** Any of these in the top k counts as a hit. Empty for noise queries. */
  answers: string[];
  /** None of these may appear in the top 3. */
  forbid?: string[];
  /** The label is a judgement call and should be double-checked by a human. */
  review?: boolean;
  note?: string;
}

export const stripVariation = (emoji: string) => emoji.replace(/️/g, "");

export function loadQueries(path: string): EvalQuery[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const q = JSON.parse(line) as EvalQuery;
      if (!q.id || !q.q || !Array.isArray(q.answers)) throw new Error(`queries line ${i + 1}: invalid`);
      return q;
    });
}
