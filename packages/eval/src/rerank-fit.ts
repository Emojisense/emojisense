/**
 * The fit of the learned fusion (core rerank.ts), shared by `rerank:train` (production weights)
 * and `eval:models` (weights for another embedding model): a linear score per candidate, a
 * listwise softmax loss (the answers share the probability mass) and L2, on standardized features.
 */
import { RERANK_WEIGHTS, type RerankInput, rerankFeatures, type SearchResult } from "emojisense";
import { stripVariation } from "./queries.ts";

const L2 = 0.01;
const EPOCHS = 400;

export interface RerankCandidates {
  /** Features of each candidate below the pinned alias results, and whether it is an answer. */
  candidates: { features: number[]; positive: boolean }[];
}

/** The candidates the reranker orders for one query: alias then semantic, pinned results left out. */
export function rerankCandidates(input: RerankInput, answers: readonly string[]): RerankCandidates {
  const wanted = new Set(answers.map(stripVariation));
  const seen = new Set(input.alias.results.filter((r) => r.score >= 0.9).map((r) => r.id));
  const candidates: RerankCandidates["candidates"] = [];
  for (const r of [...input.alias.results, ...input.semantic] as SearchResult[]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    candidates.push({ features: rerankFeatures(input, r.id), positive: wanted.has(stripVariation(r.emoji)) });
  }
  return { candidates };
}

/**
 * Returns `train(subset)`: raw-feature weights (the standardization folded in) fitted on the
 * subset. Mean and deviation come from every item, so folds share one scale.
 */
export function createRerankFit(items: readonly RerankCandidates[]) {
  const dim = RERANK_WEIGHTS.length;
  const rows = items.flatMap((it) => it.candidates.map((c) => c.features));
  const mean = Array.from(
    { length: dim },
    (_, d) => rows.reduce((s, x) => s + (x[d] as number), 0) / rows.length,
  );
  const std = Array.from(
    { length: dim },
    (_, d) =>
      Math.sqrt(rows.reduce((s, x) => s + ((x[d] as number) - (mean[d] as number)) ** 2, 0) / rows.length) ||
      1,
  );

  return function train(training: readonly RerankCandidates[]): number[] {
    const usable = training.filter((it) => it.candidates.some((c) => c.positive));
    const X = usable.map((it) =>
      it.candidates.map((c) => c.features.map((v, d) => (v - (mean[d] as number)) / (std[d] as number))),
    );
    const w = new Array<number>(dim).fill(0);
    const m = new Array<number>(dim).fill(0);
    const v = new Array<number>(dim).fill(0);
    for (let t = 1; t <= EPOCHS; t++) {
      const grad = new Array<number>(dim).fill(0);
      usable.forEach((it, qi) => {
        const xs = X[qi] as number[][];
        const s = xs.map((x) => x.reduce((acc, xv, d) => acc + xv * (w[d] as number), 0));
        const max = Math.max(...s);
        const e = s.map((value) => Math.exp(value - max));
        const total = e.reduce((a, b) => a + b, 0);
        const positive = it.candidates.reduce((a, c, k) => a + (c.positive ? (e[k] as number) : 0), 0);
        xs.forEach((x, k) => {
          const coef =
            (e[k] as number) / total -
            ((it.candidates[k] as { positive: boolean }).positive ? (e[k] as number) / positive : 0);
          for (let d = 0; d < dim; d++) grad[d] = (grad[d] as number) + coef * (x[d] as number);
        });
      });
      for (let d = 0; d < dim; d++) {
        const g = (grad[d] as number) / usable.length + L2 * (w[d] as number);
        m[d] = 0.9 * (m[d] as number) + 0.1 * g;
        v[d] = 0.999 * (v[d] as number) + 0.001 * g * g;
        const step =
          (0.05 * ((m[d] as number) / (1 - 0.9 ** t))) /
          (Math.sqrt((v[d] as number) / (1 - 0.999 ** t)) + 1e-8);
        w[d] = (w[d] as number) - step;
      }
    }
    return w.map((value, d) => value / (std[d] as number));
  };
}

/** Four significant digits: what the ports copy. */
export const roundWeights = (weights: number[]) => weights.map((w) => Number(w.toPrecision(4)));
