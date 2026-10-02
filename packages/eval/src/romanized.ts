/**
 * Romanized and slang dev set: Hinglish, Banglish, Arabizi and slang written in Latin letters,
 * plus country queries that must keep their flag first. Written for tuning the ranking (the
 * held-out set is never used for that); see DECISIONS.md, "Ranking follow-ups".
 *
 *   pnpm --filter @emojisense/eval romanized               embeds missing queries via Workers AI
 *   pnpm --filter @emojisense/eval romanized -- --offline  cached query vectors only
 *
 * Each locale gets the engine a client has for it (en + that locale, core + ext). Prints and
 * writes reports/romanized.md: recall per category and mode, the share of non-country queries
 * with a country flag in the top 5, and how many country queries rank their flag first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { disposeEmbeddings, embedTexts } from "@emojisense/data/embeddings";
import { formatQuery, getModel } from "@emojisense/data/models";
import { DATA_ROOT } from "@emojisense/data/paths";
import {
  type AliasEngine,
  createEngine,
  decodeVectors,
  embeddingText,
  fuse,
  l2normalize,
  type Pack,
  type SearchResult,
  searchVectors,
  shouldUseSemantic,
} from "emojisense";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { loadQueries } from "./queries.ts";

const LIMIT = 10;
const COUNTRY_FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$|^\u{1F3F4}[\u{E0020}-\u{E007F}]+$/u;
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { pack: { type: "string" }, offline: { type: "boolean", default: false } },
});
const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packConfig.packVersion);
const readPack = (name: string): Pack => JSON.parse(readFileSync(join(packDir, `pack.${name}.json`), "utf8"));
const en = [readPack("en"), readPack("en.ext")];
const engines = new Map<string, AliasEngine>();
function engineFor(locale: string): AliasEngine {
  let engine = engines.get(locale);
  if (!engine) {
    engine = createEngine(locale === "en" ? en : [...en, readPack(locale), readPack(`${locale}.ext`)]);
    engines.set(locale, engine);
  }
  return engine;
}

const queries = loadQueries(join(EVAL_ROOT, "queries", "romanized-dev.jsonl"));
const { key, dims } = packConfig.model;
const model = getModel(key);
const index = decodeVectors(readFileSync(join(packDir, `vectors.${key}.${dims}.bin`)));
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

type Mode = "alias" | "semantic" | "fused" | "gated";
const MODES: Mode[] = ["alias", "semantic", "fused", "gated"];
const rows = queries.map((q, i) => {
  const engine = engineFor(q.locale);
  const alias = engine.search(q.q, { locale: q.locale, limit: 24 });
  const semantic: SearchResult[] = searchVectors(
    index,
    l2normalize((vectors[i] as Float32Array).slice(0, dims)),
    24,
  ).map((m) => ({ emoji: engine.get(m.id)?.emoji ?? "", id: m.id, score: m.score, source: "semantic" }));
  const fused = fuse(alias, semantic, LIMIT);
  const lists: Record<Mode, string[]> = {
    alias: alias.results.slice(0, LIMIT).map((r) => r.emoji),
    semantic: semantic.slice(0, LIMIT).map((r) => r.emoji),
    fused: fused.map((r) => r.emoji),
    gated: (shouldUseSemantic(alias) ? fused : alias.results.slice(0, LIMIT)).map((r) => r.emoji),
  };
  return { q, lists };
});

const pct = (n: number, of: number) => (of === 0 ? "–" : ((100 * n) / of).toFixed(1));
const outcomes = (subset: typeof rows, mode: Mode): QueryOutcome[] =>
  subset.map(({ q, lists }) => judge(q, lists[mode]));
const lines = [
  "# Romanized and slang dev set",
  "",
  `- ${queries.length} queries (queries/romanized-dev.jsonl) · pack ${packConfig.packVersion} · ` +
    `${key}@${dims} · embedded text = \`embeddingText(q)\`, as the Worker embeds it`,
  "- gated = what a client shows: fused only when `shouldUseSemantic` calls the semantic tier.",
  "",
  "## Recall@5 (R@1 in brackets)",
  "",
  `| Category | n | ${MODES.join(" | ")} |`,
  `| --- | --: | ${MODES.map(() => "--:").join(" | ")} |`,
];
const categories = [...new Set(queries.map((q) => q.cat))];
for (const cat of [...categories, "all"]) {
  const subset = cat === "all" ? rows : rows.filter((r) => r.q.cat === cat);
  const cells = MODES.map((mode) => {
    const s = summarize(outcomes(subset, mode));
    return `${s.r5} (${s.r1})`;
  });
  lines.push(`| ${cat} | ${subset.length} | ${cells.join(" | ")} |`);
}

const others = rows.filter((r) => r.q.cat !== "country");
const countries = rows.filter((r) => r.q.cat === "country");
const flagNoise = (mode: Mode) =>
  pct(
    others.filter((r) => r.lists[mode].slice(0, 5).some((e) => COUNTRY_FLAG.test(e))).length,
    others.length,
  );
const flagFirst = (mode: Mode) =>
  `${countries.filter((r) => judge(r.q, r.lists[mode]).rank === 1).length}/${countries.length}`;
lines.push(
  "",
  "## Country flags",
  "",
  `| Measure | ${MODES.join(" | ")} |`,
  `| --- | ${MODES.map(() => "--:").join(" | ")} |`,
  `| Non-country queries with a country flag in the top 5, % | ${MODES.map(flagNoise).join(" | ")} |`,
  `| Country queries with their flag first | ${MODES.map(flagFirst).join(" | ")} |`,
);

const report = lines.join("\n");
writeFileSync(join(EVAL_ROOT, "reports", "romanized.md"), `${report}\n`);
console.log(report);
