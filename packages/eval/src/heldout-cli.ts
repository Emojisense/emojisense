/**
 * The held-out suite alone (`pnpm eval` runs it too, after the in-house suite).
 *
 *   pnpm eval:heldout                      embeds missing queries via Workers AI
 *   pnpm eval:heldout -- --offline         cached query vectors only; fused is skipped without them
 *   pnpm eval:heldout -- --write-baseline  store this run as reports/heldout-baseline.json
 *
 * Writes reports/heldout.md and reports/heldout.json. In-house numbers for comparison come from
 * reports/latest.json. A drop against the baseline is a warning, never a failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DATA_ROOT } from "@emojisense/data/paths";
import type { InHouseScores } from "./heldout-report.ts";
import { ALIAS_MODE, runAndReportHeldout } from "./heldout-run.ts";
import type { Summary } from "./metrics.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    pack: { type: "string" },
    offline: { type: "boolean", default: false },
    "write-baseline": { type: "boolean", default: false },
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
