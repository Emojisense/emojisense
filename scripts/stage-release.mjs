// Stage every public npm package (packages/*, not private) whose version npm does not have yet, for
// the release workflow (.github/workflows/release.yml). `npm stage publish` needs no 2FA and makes
// nothing public: a person approves each staged version later (npmjs.com → Staged Packages, or
// `npm stage approve <id>`), and only then does it go live. npm trusts the workflow only for a
// package that exists, so a package that is not on npm yet is skipped: its first release comes from
// a workstation (RELEASING.md).
//
//   node scripts/stage-release.mjs            stage, and tag each staged version <name>@<version>
//   node scripts/stage-release.mjs --dry-run  pack and report, stage and tag nothing
//
// It does not build: `pnpm release:stage` runs `release-check.mjs --build --strict` first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: ROOT, encoding: "utf8", stdio: "pipe", ...options });
}

function publicPackages() {
  return readdirSync(join(ROOT, "packages"))
    .sort()
    .map((dir) => join(ROOT, "packages", dir))
    .filter((path) => existsSync(join(path, "package.json")))
    .map((path) => ({ path, manifest: JSON.parse(readFileSync(join(path, "package.json"), "utf8")) }))
    .filter(({ manifest }) => !manifest.private);
}

/** "published", "missing" (npm has the package, not this version) or "new" (npm has no such package). */
function registryState(name, version) {
  try {
    const versions = [].concat(JSON.parse(run("npm", ["view", name, "versions", "--json"])));
    return versions.includes(version) ? "published" : "missing";
  } catch (error) {
    if (/E404/.test(String(error.stderr))) return "new";
    throw error;
  }
}

function tagExists(tag) {
  return run("git", ["tag", "--list", tag]).trim() === tag;
}

const scratch = mkdtempSync(join(tmpdir(), "emojisense-stage-"));
const rows = [];
let failed = false;

for (const { path, manifest } of publicPackages()) {
  const { name, version } = manifest;
  const state = registryState(name, version);
  if (state === "published") {
    rows.push([name, version, "on npm already"]);
    continue;
  }
  if (state === "new") {
    rows.push([name, version, "skipped: not on npm yet, first release from a workstation"]);
    continue;
  }
  // pnpm turns `workspace:` ranges into versions; npm stages the tarball as it is.
  const tarball = run("pnpm", ["pack", "--pack-destination", scratch], { cwd: path })
    .trim()
    .split("\n")
    .pop();
  const tag = version.includes("-") ? ["--tag", "next"] : [];
  try {
    run("npm", ["stage", "publish", tarball, "--access", "public", ...tag, ...(dryRun ? ["--dry-run"] : [])]);
  } catch (error) {
    failed = true;
    rows.push([name, version, `FAILED: ${String(error.stderr).trim().split("\n").pop()}`]);
    continue;
  }
  const gitTag = `${name}@${version}`;
  if (!dryRun && !tagExists(gitTag)) run("git", ["tag", gitTag]);
  rows.push([name, version, dryRun ? "would stage" : `staged, tagged ${gitTag}`]);
}

for (const [name, version, result] of rows) console.log(`${name.padEnd(28)} ${version.padEnd(10)} ${result}`);
if (rows.some(([, , result]) => result.startsWith("staged"))) {
  console.log("\nApprove each staged version: npmjs.com → Staged Packages, or `npm stage approve <id>`.");
}
if (failed) process.exitCode = 1;
