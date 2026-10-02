import { type EvalQuery, stripVariation } from "./queries.ts";

export interface QueryOutcome {
  id: string;
  cat: string;
  /** 1-based rank of the first acceptable answer, 0 when none in the list. */
  rank: number;
  forbidHit: boolean;
  top: string[];
}

export interface Summary {
  n: number;
  r1: number;
  r5: number;
  r10: number;
  mrr: number;
  forbidRate: number;
}

export function judge(query: EvalQuery, ranked: string[]): QueryOutcome {
  const list = ranked.map(stripVariation);
  const answers = new Set(query.answers.map(stripVariation));
  const forbid = new Set((query.forbid ?? []).map(stripVariation));
  const index = list.findIndex((e) => answers.has(e));
  return {
    id: query.id,
    cat: query.cat,
    rank: index + 1,
    forbidHit: list.slice(0, 3).some((e) => forbid.has(e)),
    top: ranked.slice(0, 5),
  };
}

const pct = (n: number) => Math.round(n * 1000) / 10;

export function summarize(outcomes: QueryOutcome[]): Summary {
  const n = outcomes.length || 1;
  const within = (k: number) => outcomes.filter((o) => o.rank > 0 && o.rank <= k).length / n;
  return {
    n: outcomes.length,
    r1: pct(within(1)),
    r5: pct(within(5)),
    r10: pct(within(10)),
    mrr:
      Math.round(
        (outcomes.reduce((s, o) => s + (o.rank > 0 && o.rank <= 10 ? 1 / o.rank : 0), 0) / n) * 1000,
      ) / 1000,
    forbidRate: pct(outcomes.filter((o) => o.forbidHit).length / n),
  };
}

/** Unweighted mean of group summaries: a small group counts as much as a large one. */
export function macroAverage(groups: readonly Summary[]): Summary {
  const mean = (key: Exclude<keyof Summary, "n">, places: number) => {
    if (groups.length === 0) return 0;
    const value = groups.reduce((sum, s) => sum + s[key], 0) / groups.length;
    return Math.round(value * 10 ** places) / 10 ** places;
  };
  return {
    n: groups.reduce((sum, s) => sum + s.n, 0),
    r1: mean("r1", 1),
    r5: mean("r5", 1),
    r10: mean("r10", 1),
    mrr: mean("mrr", 3),
    forbidRate: mean("forbidRate", 1),
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}
