/**
 * The semantic tier per locale: recall@5 of semantic-only, fused and gated ranking on the in-house
 * suite (en, tr) and the multilingual dev suite (queries/semantic-dev.jsonl: zh, hi, es, ar, fr,
 * bn, pt, ru, id). Use it to tune embedding documents; the held-out suite stays a final check.
 *
 *   pnpm --filter @emojisense/eval eval:semantic                 embeds missing queries via Workers AI
 *   pnpm --filter @emojisense/eval eval:semantic -- --offline    cached query vectors only
 *   pnpm --filter @emojisense/eval eval:semantic -- --pack DIR   another pack directory
 *
 * Each locale gets the packs a client loads (en + that locale, core + ext) and the production
 * model's vector layout (PACK_FORMAT §5). Prints a table and writes nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { disposeEmbeddings, embedTexts } from "@emojisense/data/embeddings";
import { LOCALE_CODES } from "@emojisense/data/locales";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { type AliasEngine, embeddingText, type Pack, type SearchResult, shouldUseSemantic } from "emojisense";
import { l2normalize } from "emojisense/vectors";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { type EvalQuery, loadQueries } from "./queries.ts";
import { fuseRanked, rankingEngine, semanticSearch } from "./ranking.ts";
import { loadVectorLayout } from "./vector-layout.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const LIMIT = 10;
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { pack: { type: "string" }, offline: { type: "boolean", default: false } },
});
const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packConfig.packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}
const model = getModel(packConfig.model.key);
const { dims } = packConfig.model;
const layout = loadVectorLayout(packDir, model, dims);
if (!layout) {
  console.error(`No vectors.${model.key}.${dims}*.bin in ${packDir}. Run the embed step.`);
  process.exit(2);
}

const queries = [
  ...loadQueries(join(EVAL_ROOT, "queries", "queries.jsonl")),
  ...loadQueries(join(EVAL_ROOT, "queries", "semantic-dev.jsonl")),
].filter((q) => q.answers.length > 0);
const locales = LOCALE_CODES.filter((l) => queries.some((q) => q.locale === l));

const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const en = [readPack("en"), readPack("en.ext")];
const engines = new Map<string, AliasEngine>(
  locales.map((l) => [l, rankingEngine(l === "en" ? en : [...en, readPack(l), readPack(`${l}.ext`)])]),
);

let vectors: Float32Array[];
try {
  ({ vectors } = await embedTexts(
    model,
    // Exactly what the Worker embeds for this query (search.ts), not the raw text.
    queries.map((q) => formatQuery(model, embeddingText(q.q))),
    "query",
    { offline: args.offline },
  ));
} finally {
  await disposeEmbeddings();
}

const outcomes: Record<"semantic" | "fused" | "gated", QueryOutcome[]> = {
  semantic: [],
  fused: [],
  gated: [],
};
const top = (list: readonly SearchResult[]) => list.slice(0, LIMIT).map((r) => r.emoji);
queries.forEach((q: EvalQuery, i) => {
  const engine = engines.get(q.locale) as AliasEngine;
  const query = l2normalize((vectors[i] as Float32Array).slice(0, dims));
  const semantic = semanticSearch(engine, layout, q.locale, query, 24);
  const alias = engine.search(q.q, { locale: q.locale, limit: 24 });
  const fused = top(fuseRanked(engine, alias, semantic, LIMIT));
  outcomes.semantic.push(judge(q, top(semantic)));
  outcomes.fused.push(judge(q, fused));
  outcomes.gated.push(judge(q, shouldUseSemantic(alias) ? fused : top(alias.results)));
});

const localeOf = new Map(queries.map((q) => [q.id, q.locale]));
console.log(`Recall@5, ${layout.label}, ${queries.length} queries (in-house + dev)\n`);
console.log(
  `| Mode | ${locales.map((l) => `${l} (${queries.filter((q) => q.locale === l).length})`).join(" | ")} | all |`,
);
console.log(`| --- | ${locales.map(() => "--:").join(" | ")} | --: |`);
for (const [mode, list] of Object.entries(outcomes)) {
  const cells = locales.map((l) => summarize(list.filter((o) => localeOf.get(o.id) === l)).r5);
  console.log(`| ${mode} | ${cells.join(" | ")} | ${summarize(list).r5} |`);
}
