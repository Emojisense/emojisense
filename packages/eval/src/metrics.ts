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

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}
