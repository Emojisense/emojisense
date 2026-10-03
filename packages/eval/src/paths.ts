/**
 * The same queries through both ranking paths users meet:
 *
 *   api   the Search API (hybrid mode): the alias engine of English + the query's locale, the
 *         semantic list for that locale, fused in the Worker.
 *   first the website hero before its upgrade: the English core pack only (engine-client.ts
 *         firstEngine on an English page), the API's semantic list for "en", fused in the browser.
 *   site  the website hero after it: every demo pack (22), the same semantic list and fusion.
 *
 *   pnpm --filter @emojisense/eval eval:paths [--sets regressions-dev] [--out DIR] [--offline]
 *
 * Query vectors come from the embedding cache; misses go to Workers AI, or with
 * EMOJISENSE_LOCAL_EMBED=1 to scripts/local_embed_server.py (the same vectors).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { disposeEmbeddings, embedTexts } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import { type AliasEngine, embeddingText, type Pack, RANK_DEPTH, type SearchResult } from "emojisense";
import { l2normalize } from "emojisense/vectors";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { type EvalQuery, loadQueries } from "./queries.ts";
import { fuseRanked, rankingEngine, semanticSearch } from "./ranking.ts";
import { loadVectorLayout } from "./vector-layout.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    sets: { type: "string", default: "regressions-dev" },
    out: { type: "string" },
    offline: { type: "boolean", default: false },
  },
});

const LIMIT = 12;
const SITE_LOCALE = "en";
/** apps/web/src/lib/engine-client.ts DEMO_LOCALES: the packs of the hero's full engine. */
const DEMO_LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"];

const config: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = join(DATA_ROOT, "dist", "packs", config.packVersion);
const model = getModel(config.model.key);
const layout = loadVectorLayout(packDir, model, config.model.dims);
if (!layout) throw new Error(`no ${model.key}@${config.model.dims} vectors in ${packDir}`);

const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const en = [readPack("en"), readPack("en.ext")];
const engines = new Map<string, AliasEngine>();
const apiEngine = (locale: string): AliasEngine => {
  let engine = engines.get(locale);
  if (!engine) {
    engine = rankingEngine(locale === "en" ? en : [...en, readPack(locale), readPack(`${locale}.ext`)]);
    engines.set(locale, engine);
  }
  return engine;
};
// Core packs first, English core first: the order engine-client.ts builds them in.
const firstEngine = rankingEngine([readPack("en")]);
const siteEngine = rankingEngine(
  (["", ".ext"] as const).flatMap((part) => DEMO_LOCALES.map((locale) => readPack(`${locale}${part}`))),
);

const queries: EvalQuery[] = args.sets
  .split(",")
  .flatMap((set) => loadQueries(join(EVAL_ROOT, "queries", `${set}.jsonl`)));

const { vectors } = await embedTexts(
  model,
  queries.map((q) => formatQuery(model, embeddingText(q.q))),
  "query",
  { offline: args.offline },
).finally(disposeEmbeddings);
const vectorOf = (i: number) => l2normalize((vectors[i] as Float32Array).slice(0, config.model.dims));

interface Row {
  q: EvalQuery;
  api: QueryOutcome;
  first: QueryOutcome;
  site: QueryOutcome;
  apiTop: SearchResult[];
  firstTop: SearchResult[];
  siteTop: SearchResult[];
}
const emojis = (results: readonly SearchResult[]) => results.map((r) => r.emoji);
const rows: Row[] = queries.map((q, i) => {
  const vector = vectorOf(i);
  const engine = apiEngine(q.locale);
  const apiAlias = engine.search(q.q, { locale: q.locale, limit: RANK_DEPTH, culture: false });
  const apiTop = fuseRanked(apiAlias, semanticSearch(apiEngine("en"), layout, q.locale, vector), LIMIT);
  const siteSemantic = semanticSearch(apiEngine("en"), layout, SITE_LOCALE, vector);
  // The session searches RANK_DEPTH candidates and shows LIMIT of them (core session.ts).
  const browser = (engine: AliasEngine) =>
    fuseRanked(
      engine.search(q.q, { locale: SITE_LOCALE, limit: RANK_DEPTH, culture: false }),
      siteSemantic,
      LIMIT,
    );
  const firstTop = browser(firstEngine);
  const siteTop = browser(siteEngine);
  return {
    q,
    api: judge(q, emojis(apiTop)),
    first: judge(q, emojis(firstTop)),
    site: judge(q, emojis(siteTop)),
    apiTop,
    firstTop,
    siteTop,
  };
});

const lines: string[] = [];
const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
const forbidRate = (outcomes: QueryOutcome[]) =>
  `${Math.round((1000 * outcomes.filter((o) => o.forbidHit).length) / (outcomes.length || 1)) / 10}`;
const cats = [...new Set(rows.map((r) => r.q.cat))];
lines.push(`# Ranking paths: API vs website`, "", `Sets: ${args.sets}. R@1 / R@5 / forbid@3 (%).`, "");
const PATHS = ["api", "first", "site"] as const;
row(["Set", "n", ...PATHS.flatMap((p) => [`${p} R@1 / R@5`, `${p} forbid`])]);
row(["---", "--:", ...PATHS.flatMap(() => ["--:", "--:"])]);
for (const cat of [...cats, "all"]) {
  const subset = cat === "all" ? rows : rows.filter((r) => r.q.cat === cat);
  row([
    cat,
    subset.length,
    ...PATHS.flatMap((p) => {
      const outcomes = subset.map((r) => r[p]);
      const s = summarize(outcomes);
      return [`${s.r1} / ${s.r5}`, forbidRate(outcomes)];
    }),
  ]);
}
lines.push("", "## Misses (no answer in the top 5, or a forbidden emoji in the top 3)", "");
row(["Query", "locale", ...PATHS.map((p) => `${p} top 5`)]);
row(["---", "---", ...PATHS.map(() => "---")]);
const bad = (o: QueryOutcome) => o.rank === 0 || o.rank > 5 || o.forbidHit;
for (const r of rows) {
  if (PATHS.every((p) => !bad(r[p]))) continue;
  const tops = { api: r.apiTop, first: r.firstTop, site: r.siteTop };
  row([
    r.q.q,
    r.q.locale,
    ...PATHS.map((p) => `${bad(r[p]) ? "✗ " : ""}${emojis(tops[p]).slice(0, 5).join(" ")}`),
  ]);
}

const report = lines.join("\n");
const json = rows.map((r) => ({
  id: r.q.id,
  q: r.q.q,
  api: { rank: r.api.rank, forbid: r.api.forbidHit, top: emojis(r.apiTop).slice(0, 5) },
  first: { rank: r.first.rank, forbid: r.first.forbidHit, top: emojis(r.firstTop).slice(0, 5) },
  site: { rank: r.site.rank, forbid: r.site.forbidHit, top: emojis(r.siteTop).slice(0, 5) },
}));
const outDir = args.out ?? join(EVAL_ROOT, "reports");
writeFileSync(join(outDir, "paths.md"), `${report}\n`);
writeFileSync(join(outDir, "paths.json"), `${JSON.stringify(json, null, 1)}\n`);
console.log(report);
