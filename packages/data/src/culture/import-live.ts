/**
 * Write the entries editors approved in the dashboard (D1 `culture_entries_live`) to
 * culture/entries/<id>.json, so git stays the long-term record (culture Phase 2).
 *
 *   tsx src/culture/import-live.ts --file culture-live-export.json     the dashboard's "Export to git"
 *   tsx src/culture/import-live.ts --d1 local                          the local D1 (wrangler dev state)
 *   tsx src/culture/import-live.ts --d1 remote --env dev|production    read-only query of a deployed D1
 *   … [--force] [--dry-run]
 *
 * An entry whose file exists with other content is a conflict unless --force. Then run
 * culture:check, review the diff and commit. After the next deploy the git entry is served and
 * its live copy is only history (the API Worker's publish skips ids the deployed files have).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DATA_ROOT } from "../paths.ts";
import { loadCatalog } from "./catalog.ts";
import { loadExclusions } from "./exclusions.ts";
import { importLiveEntries, parseLiveExport } from "./live-import.ts";
import type { CultureRecord } from "./types.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    file: { type: "string" },
    d1: { type: "string" },
    env: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const QUERY = "SELECT record FROM culture_entries_live WHERE status = 'approved' ORDER BY id";

/** A read-only `wrangler d1 execute` in the API Worker's directory (its wrangler.jsonc). */
function readD1(where: string, env: string | undefined): CultureRecord[] {
  const workerDir = join(DATA_ROOT, "..", "worker");
  const target =
    where === "remote"
      ? ["--remote", ...(env ? ["--env", env] : [])]
      : ["--local", "--env", "offline", "--persist-to", "../../.wrangler/state"];
  const output = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", ...target, "--json", "--command", QUERY],
    { cwd: workerDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const [first] = JSON.parse(output) as { results: { record: string }[] }[];
  return (first?.results ?? []).map((row) => JSON.parse(row.record) as CultureRecord);
}

let entries: CultureRecord[];
if (args.file) {
  entries = parseLiveExport(readFileSync(args.file, "utf8")).entries;
} else if (args.d1 === "local" || args.d1 === "remote") {
  if (args.d1 === "remote" && !args.env) {
    console.error("culture:import-live: --d1 remote needs --env dev|production");
    process.exit(2);
  }
  entries = readD1(args.d1, args.env);
} else {
  console.error("culture:import-live: pass --file <export.json> or --d1 local|remote");
  process.exit(2);
}

const result = importLiveEntries(
  entries,
  { catalog: loadCatalog(), exclusions: loadExclusions() },
  { force: args.force, dryRun: args["dry-run"] },
);
for (const id of result.written) console.log(`✔ ${id}${args["dry-run"] ? " (dry run)" : ""}`);
for (const id of result.unchanged) console.log(`= ${id}: already in git`);
for (const id of result.conflicts)
  console.log(`✘ ${id}: another entry with this id is in git (--force replaces it)`);
for (const { id, errors } of result.invalid) console.log(`✘ ${id}: ${errors.join("; ")}`);
console.log(
  `culture:import-live: ${result.written.length} written, ${result.unchanged.length} unchanged, ` +
    `${result.conflicts.length} conflicts, ${result.invalid.length} invalid. Next: pnpm culture:check, review, commit.`,
);
process.exit(result.conflicts.length + result.invalid.length > 0 ? 1 : 0);
