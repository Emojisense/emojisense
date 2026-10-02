// Creates the website's own account, app and publishable key in one environment's D1, once.
//   node scripts/create-site-key.mjs dev|production
// The key is bound to the site's origins and written to .deploy/<env>.env (gitignored) as
// PUBLIC_PUBLISHABLE_KEY, which scripts/deploy.sh reads. Publishable keys are public: they ship in
// the site's JavaScript. If the file already has a key, nothing is created. The account gets
// SITE_PLAN, whose limits cap what the public key can spend in a month; an account made before
// that plan is moved with scripts/set-site-plan.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayPrefix, generateKey, hashKey, randomId } from "../packages/platform/dist/index.js";
import { quote, SITE_ACCOUNT_NAME, SITE_ORIGINS, SITE_PLAN } from "./site-account.mjs";

const environment = process.argv[2];
const origins = SITE_ORIGINS[environment];
if (!origins) {
  console.error("Usage: node scripts/create-site-key.mjs dev|production");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".deploy", `${environment}.env`);
const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
if (/^PUBLIC_PUBLISHABLE_KEY=pk_live_/m.test(existing)) {
  console.log(`${envFile} already has a website key. Nothing to do.`);
  process.exit(0);
}

const now = Date.now();
const accountId = randomId();
const appId = randomId();
const key = generateKey("publishable");
const sql = [
  `INSERT INTO accounts (id, email, name, plan, created_at) VALUES (${quote(accountId)}, NULL, ${quote(SITE_ACCOUNT_NAME)}, ${quote(SITE_PLAN)}, ${now});`,
  `INSERT INTO apps (id, account_id, name, environment, plan, created_at) VALUES (${quote(appId)}, ${quote(accountId)}, 'Website (${environment})', 'prod', ${quote(SITE_PLAN)}, ${now});`,
  `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at) VALUES (${quote(randomId())}, ${quote(appId)}, 'publishable', ${quote(displayPrefix(key))}, ${quote(await hashKey(key))}, ${quote(JSON.stringify(origins))}, ${now});`,
].join("\n");

execFileSync(
  "pnpm",
  ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", environment, "--command", sql],
  { cwd: join(root, "packages/worker"), stdio: ["ignore", "ignore", "inherit"] },
);

mkdirSync(dirname(envFile), { recursive: true });
writeFileSync(
  envFile,
  `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}PUBLIC_PUBLISHABLE_KEY=${key}\n`,
);
console.log(
  `Created the website key ${displayPrefix(key)}… (plan ${SITE_PLAN}) for ${origins.join(", ")} → ${envFile}`,
);
