/** Precision of a ranked emoji list against a small set of acceptable answers. */

const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VARIATION = /[︎️]/g;

/** Variation selectors and skin tones do not change which emoji it is. */
export const canonicalEmoji = (emoji: string) => emoji.replace(VARIATION, "").replace(SKIN_TONE, "");

export interface Judged {
  /** The first 4 results as returned. */
  top: string[];
  /** Top 1 is acceptable (0 or 1). */
  p1: number;
  /** Share of the top 4 that is acceptable. */
  p4: number;
  /** Any acceptable emoji in the top 4. */
  hit4: boolean;
  /** Best possible p4 with this many answers: min(4, answers) / 4. */
  ceiling4: number;
  /** A forbidden emoji (a known trap) is in the top 4. */
  trap4: boolean;
}

export function judgeRanking(
  ranked: readonly string[],
  answers: readonly string[],
  forbid: readonly string[] = [],
): Judged {
  const ok = new Set(answers.map(canonicalEmoji));
  const traps = new Set(forbid.map(canonicalEmoji));
  const top = ranked.slice(0, 4);
  const good = top.filter((e) => ok.has(canonicalEmoji(e))).length;
  return {
    top,
    p1: top[0] !== undefined && ok.has(canonicalEmoji(top[0])) ? 1 : 0,
    p4: good / 4,
    hit4: good > 0,
    ceiling4: Math.min(4, ok.size) / 4,
    trap4: top.some((e) => traps.has(canonicalEmoji(e))),
  };
}

export interface PrecisionSummary {
  n: number;
  /** Percentages, one decimal. */
  p1: number;
  p4: number;
  hit4: number;
  /** Mean best possible p4 for these labels. */
  ceiling4: number;
  trap4: number;
}

const pct = (n: number) => Math.round(n * 1000) / 10;

export function summarizePrecision(items: readonly Judged[]): PrecisionSummary {
  const n = items.length || 1;
  const mean = (pick: (j: Judged) => number) => pct(items.reduce((s, j) => s + pick(j), 0) / n);
  return {
    n: items.length,
    p1: mean((j) => j.p1),
    p4: mean((j) => j.p4),
    hit4: mean((j) => (j.hit4 ? 1 : 0)),
    ceiling4: mean((j) => j.ceiling4),
    trap4: mean((j) => (j.trap4 ? 1 : 0)),
  };
}
