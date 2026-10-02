/**
 * Validate every culture record (culture/entries/*.json).
 *
 *   tsx src/culture/check.ts           errors fail, warnings are listed
 *   tsx src/culture/check.ts --fix     normalize triggers and rewrite files in the canonical key order
 */
import { parseArgs } from "node:util";
import { normalize } from "emojisense";
import { loadCatalog } from "./catalog.ts";
import { loadExclusions } from "./exclusions.ts";
import { loadRecords, writeRecord } from "./records.ts";
import { validateRecords } from "./validate.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { fix: { type: "boolean", default: false } },
});

const loaded = loadRecords();
if (args.fix) {
  for (const { record } of loaded) {
    record.triggers = Object.fromEntries(
      Object.entries(record.triggers).map(([locale, list]) => [
        locale,
        [...new Set(list.map((t) => normalize(t)).filter(Boolean))],
      ]),
    );
    writeRecord(record);
  }
}

const issues = validateRecords(loaded, { catalog: loadCatalog(), exclusions: loadExclusions() });
for (const issue of issues)
  console.log(`${issue.level === "error" ? "✘" : "⚠"} ${issue.id}: ${issue.message}`);
const errors = issues.filter((i) => i.level === "error").length;
const byStatus = new Map<string, number>();
for (const { record } of loaded) byStatus.set(record.status, (byStatus.get(record.status) ?? 0) + 1);
console.log(
  `culture: ${loaded.length} entries (${[...byStatus].map(([s, n]) => `${n} ${s}`).join(", ")}), ` +
    `${errors} errors, ${issues.length - errors} warnings`,
);
process.exit(errors > 0 ? 1 : 0);
