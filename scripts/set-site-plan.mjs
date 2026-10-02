// Prints the SQL that moves the website's own account to SITE_PLAN (scripts/site-account.mjs).
//   node scripts/set-site-plan.mjs dev|production
// It runs nothing: review the output, then run the printed wrangler commands yourself. The
// account is found by the hash of the site key (PUBLIC_PUBLISHABLE_KEY or .deploy/<env>.env, as in
// scripts/deploy.sh); without the key, by its name. The key itself is never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashKey, PLANS, periodOf } from "../packages/platform/dist/index.js";
import { quote, SITE_ACCOUNT_NAME, SITE_ORIGINS, SITE_PLAN } from "./site-account.mjs";

const environment = process.argv[2];
if (!SITE_ORIGINS[environment]) {
  console.error("Usage: node scripts/set-site-plan.mjs dev|production");
  process.exit(1);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** .deploy/ is gitignored, so a git worktree finds it only in the main checkout. */
function mainCheckoutRoot() {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return dirname(gitDir.trim());
  } catch {
    return undefined;
  }
}

function readSiteKey() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: set by scripts/deploy.sh; not a turbo task.
  const fromEnv = process.env.PUBLIC_PUBLISHABLE_KEY;
  if (fromEnv?.startsWith("pk_live_")) return fromEnv;
  for (const root of [ROOT, mainCheckoutRoot()]) {
    const file = root && join(root, ".deploy", `${environment}.env`);
    if (!file || !existsSync(file)) continue;
    const value = /^PUBLIC_PUBLISHABLE_KEY=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1];
    const key = value?.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key?.startsWith("pk_live_")) return key;
  }
  return undefined;
}

const key = readSiteKey();
const accounts = key
  ? `SELECT a.account_id FROM apps a JOIN api_keys k ON k.app_id = a.id WHERE k.hash = ${quote(await hashKey(key))}`
  : `SELECT id FROM accounts WHERE name = ${quote(SITE_ACCOUNT_NAME)} AND email IS NULL`;
const plan = quote(SITE_PLAN);
const check = [
  `SELECT id, name, plan FROM accounts WHERE id IN (${accounts});`,
  `SELECT u.metric, SUM(u.count) AS used FROM usage_monthly u JOIN apps a ON a.id = u.app_id WHERE a.account_id IN (${accounts}) AND u.period = ${quote(periodOf())} GROUP BY u.metric;`,
].join(" ");
const update = [
  `UPDATE accounts SET plan = ${plan} WHERE id IN (${accounts});`,
  // apps.plan is a legacy column (the Worker reads accounts.plan); kept equal for the dashboard.
  `UPDATE apps SET plan = ${plan} WHERE account_id IN (${accounts});`,
].join(" ");
const command = (sql) =>
  `pnpm exec wrangler d1 execute DB --remote --env ${environment} --command "${sql.replaceAll('"', '\\"')}"`;
const limits = PLANS[SITE_PLAN].limits;

console.log(`# Website account (${environment}) → plan "${SITE_PLAN}"`);
console.log(
  key
    ? "# Found by the hash of the site key."
    : `# No site key found: matched by name ("${SITE_ACCOUNT_NAME}", no email). Check that the first query returns one row.`,
);
console.log(
  `# Monthly ceiling: ${limits.semantic_calls.toLocaleString("en-US")} semantic calls, ${limits.image_classifications.toLocaleString("en-US")} image classifications.`,
);
console.log("# If this month's usage is already above it, the demos answer overLimit until next month.");
console.log("# Isolates cache keys and plans for up to 60 s, so the new limits apply within a minute.");
console.log("# Run from packages/worker. 1) Check (read-only):");
console.log(command(check));
console.log("# 2) Move the account:");
console.log(command(update));
