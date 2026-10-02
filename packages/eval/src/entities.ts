/**
 * Entities and pop culture (queries/entities-dev.jsonl: names, titles, brands, memes, holidays in
 * 11 locales): what the dictionary, the semantic tier and the API's concept tier find for names
 * the emoji data does not mention, how often a query is unsure, what the concept tier costs and
 * how long its model takes. The other dev sets and the in-house suite are the controls: their
 * unsure share is the false-alarm rate, their recall must not drop. Written for tuning; the
 * held-out set is never used here (`eval:heldout -- --concepts` is the final check).
 *
 *   pnpm --filter @emojisense/eval eval:entities               embeds missing queries, asks the concept model
 *   pnpm --filter @emojisense/eval eval:entities -- --offline  cached vectors and concept answers only
 *
 * Each locale gets the engine a client has (en + that locale, core + ext). The concept tier is
 * the Worker's code (concept-tier.ts). Writes reports/entities.md and reports/entities.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DATA_ROOT } from "@emojisense/data/paths";
import { mergeConcept, shouldUseSemantic } from "emojisense";
import { CONCEPT_MODEL, CONCEPT_TAG } from "../../worker/src/concepts/config.ts";
import { type ConceptVerdict, runConceptTier, USD_PER_1K_NEURONS } from "./concept-tier.ts";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { type DevRow, rankDevSet } from "./dev-set.ts";
import { judge, percentile, type QueryOutcome, summarize } from "./metrics.ts";
import { loadQueries } from "./queries.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});
const LIMIT = 10;
const SETS = ["entities-dev", "queries", "semantic-dev", "romanized-dev", "sentences-dev"].filter((s) =>
  existsSync(join(EVAL_ROOT, "queries", `${s}.jsonl`)),
);
type Mode = "alias" | "semantic" | "fused" | "gated" | "fused+concept" | "gated+concept";
const MODES: Mode[] = ["alias", "semantic", "fused", "gated", "fused+concept", "gated+concept"];

const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packConfig.packVersion);

interface Row extends DevRow, ConceptVerdict {
  set: string;
  ranked: Record<Mode, string[]>;
}

const devRows: (DevRow & { set: string })[] = [];
let vectorsLabel = "";
for (const set of SETS) {
  const queries = loadQueries(join(EVAL_ROOT, "queries", `${set}.jsonl`)).filter((q) => q.answers.length > 0);
  const run = await rankDevSet(queries, { pack: args.pack, offline: args.offline });
  vectorsLabel = run.vectors;
  for (const row of run.rows) devRows.push({ ...row, set });
}
const { verdicts, stats } = await runConceptTier(
  devRows.map((r) => ({ query: r.alias.query, locale: r.q.locale, alias: r.alias, semantic: r.semantic })),
  { packDir, model: packConfig.model, offline: args.offline, concurrency: Number(args.concurrency) },
);
const rows: Row[] = devRows.map((row, i) => {
  const verdict = verdicts[i] as ConceptVerdict;
  const withConcept = mergeConcept(row.fused, verdict.concept?.results ?? [], row.alias, LIMIT).map(
    (r) => r.emoji,
  );
  return {
    ...row,
    ...verdict,
    ranked: {
      ...row.lists,
      "fused+concept": withConcept,
      "gated+concept": shouldUseSemantic(row.alias)
        ? withConcept
        : row.alias.results.slice(0, LIMIT).map((r) => r.emoji),
    },
  };
});

// ── Report ─────────────────────────────────────────────────────────────────────────────────
const outcomes = (subset: Row[], mode: Mode): QueryOutcome[] => subset.map((r) => judge(r.q, r.ranked[mode]));
const pct = (n: number, of: number) => (of === 0 ? "–" : ((100 * n) / of).toFixed(1));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const lines: string[] = [];
const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
const entities = rows.filter((r) => r.set === "entities-dev");
const controls = rows.filter((r) => r.set !== "entities-dev");
lines.push(
  "# Entities and the concept tier",
  "",
  `- Pack ${packConfig.packVersion} · ${vectorsLabel} · concept model \`${CONCEPT_MODEL}\` (prompt v${CONCEPT_TAG.split(":")[1]})`,
  "- unsure = `assessConfidence`: no confident whole-token alias coverage and a flat or low semantic list.",
  "- +concept = concept results (`mergeConcept`) for unsure queries, as the API answers them. gated = the SDK: it asks the API only when `shouldUseSemantic`.",
  "",
  "## Recall by set and mode (R@1 / R@5)",
  "",
);
row(["Set", "n", "unsure", ...MODES]);
row(["---", "--:", "--:", ...MODES.map(() => "--:")]);
for (const set of SETS) {
  const subset = rows.filter((r) => r.set === set);
  row([
    set,
    subset.length,
    `${pct(subset.filter((r) => r.unsure).length, subset.length)}%`,
    ...MODES.map((m) => {
      const s = summarize(outcomes(subset, m));
      return `${s.r1} / ${s.r5}`;
    }),
  ]);
}

const breakdown = (title: string, keyOf: (r: Row) => string) => {
  lines.push("", `## Entities by ${title} (R@1 / R@5)`, "");
  row([title, "n", "unsure", "fused", "fused+concept"]);
  row(["---", "--:", "--:", "--:", "--:"]);
  for (const key of [...new Set(entities.map(keyOf))].sort()) {
    const subset = entities.filter((r) => keyOf(r) === key);
    const score = (m: Mode) => {
      const s = summarize(outcomes(subset, m));
      return `${s.r1} / ${s.r5}`;
    };
    row([
      key,
      subset.length,
      `${pct(subset.filter((r) => r.unsure).length, subset.length)}%`,
      score("fused"),
      score("fused+concept"),
    ]);
  }
};
breakdown("locale", (r) => r.q.locale);
breakdown("category", (r) => r.q.cat);

const count = (subset: Row[], status: "ok" | "none" | "missing") =>
  subset.filter((r) => r.concept?.status === status).length;
const unsureRows = rows.filter((r) => r.unsure);
const priced = stats.calls.filter((c) => c.usage?.neurons !== undefined);
const meanNeurons = mean(priced.map((c) => c.usage?.neurons ?? 0));
const usdPer1k = (meanNeurons / 1000) * USD_PER_1K_NEURONS * 1000;
const ms = stats.calls.map((c) => c.ms);
lines.push(
  "",
  "## Concept answers, cost and latency",
  "",
  `- Unsure: ${pct(entities.filter((r) => r.unsure).length, entities.length)}% of the entity queries, ` +
    `${pct(controls.filter((r) => r.unsure).length, controls.length)}% of the control queries ` +
    `(${unsureRows.length} of ${rows.length}). Answers: ${count(rows, "ok")} ok, ${count(rows, "none")} none ` +
    `(the model did not know it, or a blocked word), ${count(rows, "missing")} missing (offline or failed).`,
  `- One model call: ${mean(priced.map((c) => c.usage?.prompt_tokens ?? 0)).toFixed(0)} tokens in, ` +
    `${mean(priced.map((c) => c.usage?.completion_tokens ?? 0)).toFixed(0)} out, ${meanNeurons.toFixed(2)} neurons ` +
    `→ $${usdPer1k.toFixed(4)} per 1,000 unsure queries that miss every cache; plus one ${packConfig.model.key} ` +
    "embedding of the terms (≈ 15 tokens).",
  `- Model call from this machine (Workers AI round trip, cold; n = ${ms.length}): p50 ${percentile(ms, 50)?.toFixed(0)} ms, ` +
    `p95 ${percentile(ms, 95)?.toFixed(0)} ms. Embedding of the terms (uncached this run; n = ${stats.embedMs.length}): ` +
    `p50 ${stats.embedMs.length ? percentile(stats.embedMs, 50).toFixed(0) : "–"} ms.`,
  `- This run: ${stats.freshCalls} new model calls, ${stats.failures.length} failed${stats.failures.length ? ` (${[...new Set(stats.failures)].join(", ")})` : ""}.`,
  "",
  "## Entity misses after the concept tier (fused+concept, not in the top 5)",
  "",
);
row(["Query", "Locale", "Category", "unsure", "concept", "Expected", "Got (top 5)"]);
row(["---", "---", "---", "---", "---", "---", "---"]);
for (const r of entities) {
  const o = judge(r.q, r.ranked["fused+concept"]);
  if (o.rank > 0 && o.rank <= 5) continue;
  const concept = r.concept
    ? `${r.concept.status}${r.concept.display.length ? ` (${r.concept.display.join(", ")})` : ""}`
    : "–";
  row([
    r.q.q,
    r.q.locale,
    r.q.cat,
    r.unsure ? "yes" : "no",
    concept,
    r.q.answers.slice(0, 4).join(""),
    o.top.join(" ") || "–",
  ]);
}

const report = lines.join("\n");
writeFileSync(join(EVAL_ROOT, "reports", "entities.md"), `${report}\n`);
const summaryOf = (subset: Row[]) => ({
  n: subset.length,
  unsure: subset.filter((r) => r.unsure).length,
  modes: Object.fromEntries(MODES.map((m) => [m, summarize(outcomes(subset, m))])),
});
writeFileSync(
  join(EVAL_ROOT, "reports", "entities.json"),
  `${JSON.stringify(
    {
      date: new Date().toISOString(),
      packVersion: packConfig.packVersion,
      conceptTag: CONCEPT_TAG,
      sets: Object.fromEntries(SETS.map((set) => [set, summaryOf(rows.filter((r) => r.set === set))])),
      cost: { meanNeurons, usdPer1kModelCalls: usdPer1k },
      latency: { modelMs: { p50: percentile(ms, 50), p95: percentile(ms, 95), n: ms.length } },
    },
    null,
    1,
  )}\n`,
);
console.log(report.split("## Entity misses")[0]);
