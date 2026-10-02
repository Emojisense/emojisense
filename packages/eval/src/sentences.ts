/**
 * Sentence dev set: chat-style sentences with function words ("我想躺平", "я очень устал",
 * "aku lagi capek banget"), negations that must keep their sense, and whole-query aliases made
 * only of function words ("я тоже"). Written for tuning the function-word lists (the held-out set
 * is never used for that); see DECISIONS.md, "Function words per locale".
 *
 *   pnpm --filter @emojisense/eval sentences                       embeds missing queries via Workers AI
 *   pnpm --filter @emojisense/eval sentences -- --offline          cached query vectors only
 *   pnpm --filter @emojisense/eval sentences -- --out run.json     also writes every ranked list
 *
 * Prints and writes reports/sentences.md: recall@5 (R@1) per locale, category and mode, and the
 * share of negations with a forbidden (opposite) emoji in the top 3.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { type DevRow, DEV_MODES as MODES, type DevMode as Mode, rankDevSet } from "./dev-set.ts";
import { judge, summarize } from "./metrics.ts";
import { loadQueries } from "./queries.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const queries = loadQueries(join(EVAL_ROOT, "queries", "sentences-dev.jsonl"));
const run = await rankDevSet(queries, { pack: args.pack, offline: args.offline });
const { rows } = run;

const cell = (subset: DevRow[], mode: Mode) => {
  const s = summarize(subset.map(({ q, lists }) => judge(q, lists[mode])));
  return `${s.r5} (${s.r1})`;
};
const table = (title: string, groups: [string, DevRow[]][]) => [
  "",
  `## ${title}`,
  "",
  `| Group | n | ${MODES.join(" | ")} |`,
  `| --- | --: | ${MODES.map(() => "--:").join(" | ")} |`,
  ...groups.map(
    ([name, subset]) => `| ${name} | ${subset.length} | ${MODES.map((m) => cell(subset, m)).join(" | ")} |`,
  ),
];
const by = (key: "locale" | "cat") =>
  [...new Set(queries.map((q) => q[key]))].map((value): [string, DevRow[]] => [
    value,
    rows.filter((r) => r.q[key] === value),
  ]);

const negations = rows.filter((r) => r.q.forbid?.length);
const forbidden = (mode: Mode) =>
  `${negations.filter(({ q, lists }) => judge(q, lists[mode]).forbidHit).length}/${negations.length}`;
const lines = [
  "# Sentence dev set",
  "",
  `- ${queries.length} queries (queries/sentences-dev.jsonl) · pack ${run.packVersion} · ${run.vectors}`,
  "- Recall@5, R@1 in brackets. gated = fused only when `shouldUseSemantic` calls the semantic tier.",
  ...table("By locale", [...by("locale"), ["all", rows]]),
  ...table("By category", by("cat")),
  "",
  "## Negations with an opposite emoji in the top 3",
  "",
  `| ${MODES.join(" | ")} |`,
  `| ${MODES.map(() => "--:").join(" | ")} |`,
  `| ${MODES.map(forbidden).join(" | ")} |`,
];

const report = lines.join("\n");
writeFileSync(join(EVAL_ROOT, "reports", "sentences.md"), `${report}\n`);
console.log(report);
if (args.out) {
  const lists = rows.map(({ q, lists }) => ({ id: q.id, q: q.q, locale: q.locale, lists }));
  writeFileSync(args.out, `${JSON.stringify(lists, null, 1)}\n`);
}
