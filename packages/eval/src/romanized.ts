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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { type DevRow, DEV_MODES as MODES, type DevMode as Mode, rankDevSet } from "./dev-set.ts";
import { judge, type QueryOutcome, summarize } from "./metrics.ts";
import { loadQueries } from "./queries.ts";

const COUNTRY_FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$|^\u{1F3F4}[\u{E0020}-\u{E007F}]+$/u;
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { pack: { type: "string" }, offline: { type: "boolean", default: false } },
});

const queries = loadQueries(join(EVAL_ROOT, "queries", "romanized-dev.jsonl"));
const run = await rankDevSet(queries, { pack: args.pack, offline: args.offline });
const { rows } = run;

const pct = (n: number, of: number) => (of === 0 ? "–" : ((100 * n) / of).toFixed(1));
const outcomes = (subset: DevRow[], mode: Mode): QueryOutcome[] =>
  subset.map(({ q, lists }) => judge(q, lists[mode]));
const lines = [
  "# Romanized and slang dev set",
  "",
  `- ${queries.length} queries (queries/romanized-dev.jsonl) · pack ${run.packVersion} · ` +
    `${run.vectors} · embedded text = \`embeddingText(q)\`, as the Worker embeds it`,
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
