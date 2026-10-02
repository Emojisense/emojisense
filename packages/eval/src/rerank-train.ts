/**
 * Trains the learned fusion (core rerank.ts) on the in-house suite and the dev sets, never on the
 * held-out set. A linear score per candidate, fitted with a listwise softmax loss (the answers
 * share the probability mass) and L2, on standardized features; 5-fold cross-validation by query.
 *
 *   pnpm --filter @emojisense/eval rerank:train              embeds missing queries via Workers AI
 *   pnpm --filter @emojisense/eval rerank:train -- --offline cached query vectors only
 *
 * Prints recall per suite for reciprocal rank fusion, the cross-validated reranker and the weights
 * in core (`RERANK_WEIGHTS`), then the new weights to paste into packages/core/src/rerank.ts,
 * sdks/swift/Sources/Emojisense/Rerank.swift and sdks/kotlin/.../Rerank.kt. Writes nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { disposeEmbeddings, embedTexts } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import {
  type AliasEngine,
  type AliasSearchOutput,
  embeddingText,
  fuse,
  type Pack,
  RERANK_WEIGHTS,
  type RerankInput,
  rerank,
  rerankFeatures,
  type SearchResult,
  semanticConfidence,
  shouldUseSemantic,
} from "emojisense";
import { l2normalize } from "emojisense/vectors";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { type EvalQuery, loadQueries, stripVariation } from "./queries.ts";
import { RANKING, rankingEngine, semanticSearch } from "./ranking.ts";
import { loadVectorLayout } from "./vector-layout.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
/** Training data: every scored query of these files (never heldout*.jsonl). */
export const TRAINING_SETS: [suite: string, file: string][] = [
  ["inhouse", "queries.jsonl"],
  ["semantic-dev", "semantic-dev.jsonl"],
  ["romanized-dev", "romanized-dev.jsonl"],
  ["sentences-dev", "sentences-dev.jsonl"],
  ["ranking-dev", "ranking-dev.jsonl"],
];
const FOLDS = 5;
const L2 = 0.01;
const EPOCHS = 400;
const LIMIT = 10;

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { offline: { type: "boolean", default: false } },
});
const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = join(DATA_ROOT, "dist", "packs", packConfig.packVersion);
const model = getModel(packConfig.model.key);
const { dims } = packConfig.model;
const layout = loadVectorLayout(packDir, model, dims);
if (!layout) throw new Error(`no vectors.${model.key}.${dims}*.bin in ${packDir}: run the embed step`);

const queries = TRAINING_SETS.flatMap(([suite, file]) =>
  loadQueries(join(EVAL_ROOT, "queries", file))
    .filter((q) => q.answers.length > 0)
    .map((q) => ({ ...q, suite })),
);
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const en = [readPack("en"), readPack("en.ext")];
const engines = new Map<string, AliasEngine>();
const engineFor = (locale: string) => {
  let engine = engines.get(locale);
  if (!engine) {
    engine = rankingEngine(locale === "en" ? en : [...en, readPack(locale), readPack(`${locale}.ext`)]);
    engines.set(locale, engine);
  }
  return engine;
};

let vectors: Float32Array[];
try {
  ({ vectors } = await embedTexts(
    model,
    queries.map((q) => formatQuery(model, embeddingText(q.q))),
    "query",
    { offline: args.offline },
  ));
} finally {
  await disposeEmbeddings();
}

interface Item {
  q: EvalQuery & { suite: string };
  alias: AliasSearchOutput;
  semantic: SearchResult[];
  input: RerankInput;
  gate: boolean;
  /** Features of each candidate below the pinned alias results, and whether it is an answer. */
  candidates: { features: number[]; positive: boolean }[];
}

const items: Item[] = queries.map((q, i) => {
  const engine = engineFor(q.locale);
  const query = l2normalize((vectors[i] as Float32Array).slice(0, dims));
  // The Search API's semantic list (worker/src/semantic.ts) and the client's alias output.
  const semantic = semanticSearch(engine, layout, q.locale, query, 24);
  const alias = engine.search(q.q, { locale: q.locale, limit: 24 });
  const input: RerankInput = {
    alias,
    semantic,
    semanticConfidence: semanticConfidence(semantic),
    popularity: engine.popularity,
  };
  const answers = new Set(q.answers.map(stripVariation));
  const seen = new Set(alias.results.filter((r) => r.score >= 0.9).map((r) => r.id));
  const candidates: Item["candidates"] = [];
  for (const r of [...alias.results, ...semantic]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    candidates.push({
      features: rerankFeatures(input, r.id),
      positive: answers.has(stripVariation(r.emoji)),
    });
  }
  return { q, alias, semantic, input, gate: shouldUseSemantic(alias), candidates };
});

// ── Listwise softmax on standardized features (Adam, L2) ─────────────────────────────────────
const dim = RERANK_WEIGHTS.length;
const rows = items.flatMap((it) => it.candidates.map((c) => c.features));
const mean = Array.from(
  { length: dim },
  (_, d) => rows.reduce((s, x) => s + (x[d] as number), 0) / rows.length,
);
const std = Array.from(
  { length: dim },
  (_, d) =>
    Math.sqrt(rows.reduce((s, x) => s + ((x[d] as number) - (mean[d] as number)) ** 2, 0) / rows.length) || 1,
);

/** Raw-feature weights (the standardization folded in; the constant term does not change a ranking). */
function train(training: Item[]): number[] {
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
}

/** Four significant digits: what the ports copy. */
const round = (weights: number[]) => weights.map((w) => Number(w.toPrecision(4)));

const cv = new Map<Item, string[]>();
for (let fold = 0; fold < FOLDS; fold++) {
  const weights = round(train(items.filter((_, i) => i % FOLDS !== fold)));
  items.forEach((it, i) => {
    if (i % FOLDS === fold)
      cv.set(
        it,
        rerank(it.input, LIMIT, weights).map((r) => r.emoji),
      );
  });
}
const trained = round(train(items));

const suites = [...TRAINING_SETS.map(([suite]) => suite), "all"];
const lines = [
  `| Fusion | mode | ${suites.flatMap((s) => [`${s} R@1`, `${s} R@5`]).join(" | ")} |`,
  `| --- | --- | ${suites.flatMap(() => ["--:", "--:"]).join(" | ")} |`,
];
function report(name: string, fused: (it: Item) => string[]) {
  const outcomes: Record<"fused" | "gated", QueryOutcome[]> = { fused: [], gated: [] };
  for (const it of items) {
    const list = fused(it);
    outcomes.fused.push(judge(it.q, list));
    outcomes.gated.push(judge(it.q, it.gate ? list : it.alias.results.slice(0, LIMIT).map((r) => r.emoji)));
  }
  for (const [mode, list] of Object.entries(outcomes)) {
    const cells = suites.flatMap((suite) => {
      const s = summarize(list.filter((_, k) => suite === "all" || items[k]?.q.suite === suite));
      return [s.r1, s.r5];
    });
    lines.push(`| ${name} | ${mode} | ${cells.join(" | ")} |`);
  }
}
const fuseWith = (it: Item, rerankOn: boolean) =>
  fuse(it.alias, it.semantic, LIMIT, undefined, { popularity: it.input.popularity, rerank: rerankOn }).map(
    (r) => r.emoji,
  );
report("reciprocal rank", (it) => fuseWith(it, false));
report(`reranker, ${FOLDS}-fold CV`, (it) => cv.get(it) as string[]);
report("reranker, RERANK_WEIGHTS in core", (it) => fuseWith(it, true));
report("reranker, new weights (train = test)", (it) => rerank(it.input, LIMIT, trained).map((r) => r.emoji));

console.log(`${items.length} queries, ${rows.length} candidates, ranking variant ${RANKING.name}\n`);
console.log(lines.join("\n"));
console.log(`\nnew weights: [${trained.join(", ")}]`);
