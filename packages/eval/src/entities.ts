/**
 * Entities and pop culture (queries/entities-dev.jsonl: names, titles, brands, memes, holidays in
 * 11 locales): what the dictionary and the semantic tier find for names the emoji data does not
 * mention, and how often a query is unsure (`assessConfidence`). The other dev sets and the
 * in-house suite are the controls: their unsure share is the false-alarm rate, their recall must
 * not drop. Written for tuning; the held-out set is never used here.
 *
 *   pnpm --filter @emojisense/eval eval:entities               embeds missing queries
 *   pnpm --filter @emojisense/eval eval:entities -- --offline  cached vectors only
 *
 * Each locale gets the engine a client has (en + that locale, core + ext). Writes
 * reports/entities.md and reports/entities.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DATA_ROOT } from "@emojisense/data/paths";
import { assessConfidence } from "emojisense";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { DEV_MODES, type DevMode, type DevRow, rankDevSet } from "./dev-set.ts";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { loadQueries } from "./queries.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
  },
});
const SETS = ["entities-dev", "queries", "semantic-dev", "romanized-dev", "sentences-dev"].filter((s) =>
  existsSync(join(EVAL_ROOT, "queries", `${s}.jsonl`)),
);

const packConfig: { packVersion: string } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);

interface Row extends DevRow {
  set: string;
  unsure: boolean;
}

const rows: Row[] = [];
let vectorsLabel = "";
for (const set of SETS) {
  const queries = loadQueries(join(EVAL_ROOT, "queries", `${set}.jsonl`)).filter((q) => q.answers.length > 0);
  const run = await rankDevSet(queries, { pack: args.pack, offline: args.offline });
  vectorsLabel = run.vectors;
  for (const row of run.rows) {
    rows.push({ ...row, set, unsure: assessConfidence(row.alias, row.semantic).unsure });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────
const outcomes = (subset: Row[], mode: DevMode): QueryOutcome[] =>
  subset.map((r) => judge(r.q, r.lists[mode]));
const pct = (n: number, of: number) => (of === 0 ? "–" : ((100 * n) / of).toFixed(1));
const lines: string[] = [];
const row = (cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);
const entities = rows.filter((r) => r.set === "entities-dev");
const controls = rows.filter((r) => r.set !== "entities-dev");
const score = (subset: Row[], mode: DevMode) => {
  const s = summarize(outcomes(subset, mode));
  return `${s.r1} / ${s.r5}`;
};
lines.push(
  "# Entities",
  "",
  `- Pack ${packConfig.packVersion} · ${vectorsLabel}`,
  "- unsure = `assessConfidence`: no confident whole-token alias coverage and a flat or low semantic list.",
  "- gated = the SDK: it asks the API only when `shouldUseSemantic`.",
  "",
  "## Recall by set and mode (R@1 / R@5)",
  "",
);
row(["Set", "n", "unsure", ...DEV_MODES]);
row(["---", "--:", "--:", ...DEV_MODES.map(() => "--:")]);
for (const set of SETS) {
  const subset = rows.filter((r) => r.set === set);
  row([
    set,
    subset.length,
    `${pct(subset.filter((r) => r.unsure).length, subset.length)}%`,
    ...DEV_MODES.map((m) => score(subset, m)),
  ]);
}

const breakdown = (title: string, keyOf: (r: Row) => string) => {
  lines.push("", `## Entities by ${title} (R@1 / R@5)`, "");
  row([title, "n", "unsure", "alias", "fused"]);
  row(["---", "--:", "--:", "--:", "--:"]);
  for (const key of [...new Set(entities.map(keyOf))].sort()) {
    const subset = entities.filter((r) => keyOf(r) === key);
    row([
      key,
      subset.length,
      `${pct(subset.filter((r) => r.unsure).length, subset.length)}%`,
      score(subset, "alias"),
      score(subset, "fused"),
    ]);
  }
};
breakdown("locale", (r) => r.q.locale);
breakdown("category", (r) => r.q.cat);

lines.push(
  "",
  `Unsure: ${pct(entities.filter((r) => r.unsure).length, entities.length)}% of the entity queries, ` +
    `${pct(controls.filter((r) => r.unsure).length, controls.length)}% of the control queries.`,
  "",
  "## Entity misses (fused, not in the top 5)",
  "",
);
row(["Query", "Locale", "Category", "unsure", "Expected", "Got (top 5)"]);
row(["---", "---", "---", "---", "---", "---"]);
for (const r of entities) {
  const o = judge(r.q, r.lists.fused);
  if (o.rank > 0 && o.rank <= 5) continue;
  row([
    r.q.q,
    r.q.locale,
    r.q.cat,
    r.unsure ? "yes" : "no",
    r.q.answers.slice(0, 4).join(""),
    o.top.join(" ") || "–",
  ]);
}

const report = lines.join("\n");
writeFileSync(join(EVAL_ROOT, "reports", "entities.md"), `${report}\n`);
const summaryOf = (subset: Row[]) => ({
  n: subset.length,
  unsure: subset.filter((r) => r.unsure).length,
  modes: Object.fromEntries(DEV_MODES.map((m) => [m, summarize(outcomes(subset, m))])),
});
writeFileSync(
  join(EVAL_ROOT, "reports", "entities.json"),
  `${JSON.stringify(
    {
      date: new Date().toISOString(),
      packVersion: packConfig.packVersion,
      sets: Object.fromEntries(SETS.map((set) => [set, summaryOf(rows.filter((r) => r.set === set))])),
    },
    null,
    1,
  )}\n`,
);
console.log(report.split("## Entity misses")[0]);
