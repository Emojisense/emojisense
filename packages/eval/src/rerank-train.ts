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
  type RerankInput,
  rerank,
  type SearchResult,
  semanticConfidence,
  shouldUseSemantic,
} from "emojisense";
import { l2normalize } from "emojisense/vectors";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { type EvalQuery, loadQueries, stripVariation } from "./queries.ts";
import { modelSearch, RANKING, rankingEngine, semanticSearch } from "./ranking.ts";
import { createRerankFit, type RerankCandidates, rerankCandidates, roundWeights } from "./rerank-fit.ts";
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
/** Scored with the trained weights but never trained on: names, titles and brands. */
const REPORT_ONLY_SETS: [suite: string, file: string][] = [["entities-dev", "entities-dev.jsonl"]];
const FOLDS = 5;
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

const load = (sets: [string, string][], train: boolean) =>
  sets.flatMap(([suite, file]) =>
    loadQueries(join(EVAL_ROOT, "queries", file))
      .filter((q) => q.answers.length > 0)
      .map((q) => ({ ...q, suite, train })),
  );
const queries = [...load(TRAINING_SETS, true), ...load(REPORT_ONLY_SETS, false)];
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

interface Item extends RerankCandidates {
  q: EvalQuery & { suite: string; train: boolean };
  alias: AliasSearchOutput;
  semantic: SearchResult[];
  input: RerankInput;
  gate: boolean;
  /** The model's own top 10 (modelSearch), for fidelity. */
  model: string[];
}

const all: Item[] = queries.map((q, i) => {
  const engine = engineFor(q.locale);
  const query = l2normalize((vectors[i] as Float32Array).slice(0, dims));
  // The Search API's semantic list (worker/src/semantic.ts) and the client's alias output.
  const semantic = semanticSearch(engine, layout, q.locale, query, 24);
  const alias = engine.search(q.q, { locale: q.locale, limit: 24 });
  const input: RerankInput = {
    alias,
    semantic,
    semanticConfidence: semanticConfidence(semantic),
  };
  const model = modelSearch(engine, layout, q.locale, query, LIMIT);
  return {
    q,
    alias,
    semantic,
    input,
    model,
    gate: shouldUseSemantic(alias),
    ...rerankCandidates(input, q.answers),
  };
});
const items = all.filter((it) => it.q.train);
const reportOnly = all.filter((it) => !it.q.train);

// ── Listwise softmax on standardized features (Adam, L2; rerank-fit.ts) ──────────────────────
const train = createRerankFit(items);
const rows = items.flatMap((it) => it.candidates);

const cv = new Map<Item, string[]>();
for (let fold = 0; fold < FOLDS; fold++) {
  const weights = roundWeights(train(items.filter((_, i) => i % FOLDS !== fold)));
  items.forEach((it, i) => {
    if (i % FOLDS === fold)
      cv.set(
        it,
        rerank(it.input, LIMIT, weights).map((r) => r.emoji),
      );
  });
}
const trained = roundWeights(train(items));

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
/**
 * Per group: recall, how much of the model's own top 10 the shown top 10 keeps (fidelity, over the
 * queries that reach the semantic tier) and how often a forbidden emoji is in the top 3.
 */
const fidelityLines = [
  "| Fusion | train R@1 | train R@5 | train fidelity | entities R@1 | entities R@5 | entities fidelity | entities forbid@3 |",
  "| --- | --: | --: | --: | --: | --: | --: | --: |",
];
function fidelityReport(name: string, fused: (it: Item) => string[]) {
  const group = (list: Item[]) => {
    const s = summarize(list.map((it) => judge(it.q, fused(it))));
    const reached = list.filter((it) => it.gate);
    const kept = reached.reduce((sum, it) => {
      const model = new Set(it.model.map(stripVariation));
      return (
        sum +
        fused(it)
          .slice(0, LIMIT)
          .filter((e) => model.has(stripVariation(e))).length /
          LIMIT
      );
    }, 0);
    return [s.r1, s.r5, Math.round((kept / (reached.length || 1)) * 1000) / 10, s.forbidRate];
  };
  const [r1, r5, fidelity] = group(items);
  fidelityLines.push(`| ${name} | ${r1} | ${r5} | ${fidelity} | ${group(reportOnly).join(" | ")} |`);
}

const fuseWith = (it: Item, rerankOn: boolean) =>
  fuse(it.alias, it.semantic, LIMIT, undefined, { rerank: rerankOn }).map((r) => r.emoji);
report("reciprocal rank", (it) => fuseWith(it, false));
report(`reranker, ${FOLDS}-fold CV`, (it) => cv.get(it) as string[]);
report("reranker, RERANK_WEIGHTS in core", (it) => fuseWith(it, true));
report("reranker, new weights (train = test)", (it) => rerank(it.input, LIMIT, trained).map((r) => r.emoji));

console.log(`${items.length} queries, ${rows.length} candidates, ranking variant ${RANKING.name}\n`);
console.log(lines.join("\n"));
fidelityReport("model's own order", (it) =>
  it.gate ? it.model : it.alias.results.slice(0, LIMIT).map((r) => r.emoji),
);
fidelityReport("reciprocal rank", (it) => fuseWith(it, false));
fidelityReport(`reranker, ${FOLDS}-fold CV (entities: all-data weights)`, (it) =>
  it.q.train ? (cv.get(it) as string[]) : rerank(it.input, LIMIT, trained).map((r) => r.emoji),
);
fidelityReport("reranker, RERANK_WEIGHTS in core", (it) => fuseWith(it, true));
console.log(`\n${fidelityLines.join("\n")}`);
console.log(`\nnew weights: [${trained.join(", ")}]`);
