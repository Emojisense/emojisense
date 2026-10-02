/**
 * The held-out suite alone (`pnpm eval` runs it too, after the in-house suite).
 *
 *   pnpm eval:heldout                      embeds missing queries via Workers AI
 *   pnpm eval:heldout -- --offline         cached query vectors only; fused is skipped without them
 *   pnpm eval:heldout -- --write-baseline  store this run as reports/heldout-baseline.json
 *   pnpm eval:heldout -- --concepts        also the API's concept tier for unsure queries (model
 *                                          answers cached on disk; aggregates are printed only)
 *
 * Writes reports/heldout.md and reports/heldout.json. In-house numbers for comparison come from
 * reports/latest.json. A drop against the baseline is a warning, never a failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DATA_ROOT } from "@emojisense/data/paths";
import { fuse, mergeConcept, type SearchResult } from "emojisense";
import { runConceptTier } from "./concept-tier.ts";
import { scoreByLocale } from "./heldout.ts";
import type { InHouseScores } from "./heldout-report.ts";
import { ALIAS_MODE, runAndReportHeldout } from "./heldout-run.ts";
import { judge, type Summary } from "./metrics.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
    "write-baseline": { type: "boolean", default: false },
    concepts: { type: "boolean", default: false },
  },
});

const packConfig: { packVersion: string; model: { key: string; dims: number } } = JSON.parse(
  readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8"),
);
const packDir = args.pack ?? join(DATA_ROOT, "dist", "packs", packConfig.packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}

function inHouseFromLatest(): InHouseScores | undefined {
  const path = join(EVAL_ROOT, "reports", "latest.json");
  if (!existsSync(path)) return undefined;
  const latest: { date: string; engines: { name: string; summary: Summary }[] } = JSON.parse(
    readFileSync(path, "utf8"),
  );
  const summaryOf = (name: string) => latest.engines.find((e) => e.name === name)?.summary;
  const alias = summaryOf(ALIAS_MODE);
  if (!alias) return undefined;
  const { key, dims } = packConfig.model;
  return {
    source: `reports/latest.json (${latest.date.slice(0, 10)})`,
    alias,
    fused: summaryOf(`fused ${key}@${dims}`),
  };
}

const run = await runAndReportHeldout({
  packDir,
  packVersion: packConfig.packVersion,
  model: packConfig.model,
  offline: args.offline,
  writeBaseline: args["write-baseline"],
  inHouse: inHouseFromLatest(),
});
for (const m of run.modes) {
  const { overall, macro } = m.scores;
  console.log(
    `${m.name}: R@1 ${overall.r1} · R@5 ${overall.r5} · MRR ${overall.mrr} · macro R@5 ${macro.r5} (n=${overall.n})`,
  );
}
console.log("wrote reports/heldout.md and reports/heldout.json");

// The concept tier: aggregates only, so no held-out text reaches a report or a log.
const { alias, semantic } = run.details;
if (args.concepts && semantic) {
  const items = run.queries.map((q) => {
    const output = alias.get(q.id);
    if (!output) throw new Error(`held-out: no alias output for ${q.id}`);
    return { query: output.query, locale: q.locale, alias: output, semantic: semantic.get(q.id) ?? [] };
  });
  const { verdicts, stats } = await runConceptTier(items, {
    packDir,
    model: packConfig.model,
    offline: args.offline,
  });
  const outcomes = run.queries.map((q, i) => {
    const item = items[i] as (typeof items)[number];
    const fused = fuse(item.alias, item.semantic as SearchResult[], 10);
    const concept = verdicts[i]?.concept?.results ?? [];
    return judge(
      q,
      mergeConcept(fused, concept, item.alias, 10).map((r) => r.emoji),
    );
  });
  const { overall, macro } = scoreByLocale(run.queries, outcomes);
  const unsure = verdicts.filter((v) => v.unsure).length;
  const answered = verdicts.filter((v) => v.concept?.status === "ok").length;
  console.log(
    `fused + concept tier: R@1 ${overall.r1} · R@5 ${overall.r5} · MRR ${overall.mrr} · macro R@5 ${macro.r5} ` +
      `(n=${overall.n}; unsure ${((100 * unsure) / overall.n).toFixed(1)}%, concept answers ${answered}, ` +
      `new model calls ${stats.freshCalls}, failed ${stats.failures.length})`,
  );
}
