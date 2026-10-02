/**
 * CI gate for the culture layer. Run after `pnpm data:build`.
 *
 *   tsx src/culture-gate-cli.ts                 approved entries, in-house + held-out suites
 *   tsx src/culture-gate-cli.ts --drafts        also draft entries (to check them before approval)
 *   tsx src/culture-gate-cli.ts --in-house      the in-house suite only (data writers)
 *
 * Fails when, with every approved culture entry active, any query of the main or held-out suite
 * gets another top-1 answer, a trigger does not bring its entry's strongest emoji into the top 3,
 * or a regional sense breaks its rules (culture-gate.ts). Held-out changes are printed as a count
 * only: held-out text never leaves the run.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readPackConfig } from "@emojisense/data/config";
import { loadCatalog, loadRecords } from "@emojisense/data/culture";
import { DATA_ROOT } from "@emojisense/data/paths";
import { runCultureGate, TRIGGER_TOP_N } from "./culture-gate.ts";
import { loadHeldout } from "./heldout.ts";
import { loadQueries } from "./queries.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    drafts: { type: "boolean", default: false },
    "in-house": { type: "boolean", default: false },
  },
});

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const { packVersion } = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}

const queries = loadQueries(join(EVAL_ROOT, "queries", "queries.jsonl"));
const hiddenQueries = args["in-house"] ? [] : loadHeldout(join(EVAL_ROOT, "queries", "heldout.jsonl"));
const records = loadRecords()
  .map((l) => l.record)
  .map((r) => (args.drafts && r.status === "draft" ? { ...r, status: "approved" as const } : r));
const result = runCultureGate({
  packDir,
  packVersion,
  records,
  catalog: loadCatalog(),
  queries,
  hiddenQueries,
});

for (const change of result.topChanges) {
  console.log(
    `✘ top-1 changed: ${change.id} "${change.q}" (${change.locale}${change.region ? `, region ${change.region}` : ""}) ` +
      `${change.before ?? "—"} → ${change.after ?? "—"}` +
      (change.cultureId ? ` by ${change.cultureId}` : ""),
  );
}
if (result.hiddenTopChanges > 0) {
  console.log(`✘ top-1 changed: ${result.hiddenTopChanges} held-out queries (text not shown)`);
}
for (const miss of result.triggerMisses) {
  console.log(
    `✘ trigger: ${miss.cultureId} "${miss.trigger}" (${miss.locale}) puts ${miss.emoji} at ` +
      `${miss.rank === 0 ? "no rank" : `rank ${miss.rank}`} (needs top ${TRIGGER_TOP_N})`,
  );
}
for (const issue of result.regionalIssues) {
  console.log(
    `${issue.blocking ? "✘" : "⚠"} regional: ${issue.cultureId} "${issue.trigger}" ` +
      `(${issue.locale}, region ${issue.region}) ${issue.problem}`,
  );
}
const active = records.filter((r) => r.status === "approved").length;
const blocking = result.regionalIssues.filter((i) => i.blocking).length;
const failed =
  result.topChanges.length + result.hiddenTopChanges + result.triggerMisses.length + blocking > 0;
console.log(
  `culture gate: ${active} ${args.drafts ? "approved and draft" : "approved"} entries active; ` +
    `${result.queries} eval queries${args["in-house"] ? " (in-house only)" : ""}, ` +
    `${result.topChanges.length + result.hiddenTopChanges} top-1 changes; ${result.triggers} triggers, ` +
    `${result.triggerMisses.length} misses; ${result.regionalEntries} regional senses, ` +
    `${result.regionalProbes} probes, ${blocking} failures | ${failed ? "✘ failed" : "✔ passed"}`,
);
process.exit(failed ? 1 : 0);
