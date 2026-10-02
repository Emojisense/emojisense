/**
 * CI gate for the culture layer. Run after `pnpm data:build`.
 *
 *   tsx src/culture-gate-cli.ts
 *
 * Fails when, with every approved culture entry active, any query of the main or held-out suite
 * gets another top-1 answer, or a trigger does not bring its entry's strongest emoji into the
 * top 3.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPackConfig } from "@emojisense/data/config";
import { loadCatalog, loadRecords } from "@emojisense/data/culture";
import { DATA_ROOT } from "@emojisense/data/paths";
import { runCultureGate, TRIGGER_TOP_N } from "./culture-gate.ts";
import { loadHeldout } from "./heldout.ts";
import { loadQueries } from "./queries.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const { packVersion } = readPackConfig();
const packDir = join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(join(packDir, "pack.en.json"))) {
  console.error(`No pack in ${packDir}. Run: pnpm data:build`);
  process.exit(2);
}

const queries = [
  ...loadQueries(join(EVAL_ROOT, "queries", "queries.jsonl")),
  ...loadHeldout(join(EVAL_ROOT, "queries", "heldout.jsonl")),
];
const records = loadRecords().map((l) => l.record);
const result = runCultureGate({ packDir, packVersion, records, catalog: loadCatalog(), queries });

for (const change of result.topChanges) {
  console.log(
    `✘ top-1 changed: ${change.id} "${change.q}" (${change.locale}) ${change.before ?? "—"} → ${change.after ?? "—"}` +
      (change.cultureId ? ` by ${change.cultureId}` : ""),
  );
}
for (const miss of result.triggerMisses) {
  console.log(
    `✘ trigger: ${miss.cultureId} "${miss.trigger}" (${miss.locale}) puts ${miss.emoji} at ` +
      `${miss.rank === 0 ? "no rank" : `rank ${miss.rank}`} (needs top ${TRIGGER_TOP_N})`,
  );
}
const approved = records.filter((r) => r.status === "approved").length;
const failed = result.topChanges.length + result.triggerMisses.length > 0;
console.log(
  `culture gate: ${approved} approved entries active; ${result.queries} eval queries, ` +
    `${result.topChanges.length} top-1 changes; ${result.triggers} triggers, ` +
    `${result.triggerMisses.length} misses | ${failed ? "✘ failed" : "✔ passed"}`,
);
process.exit(failed ? 1 : 0);
