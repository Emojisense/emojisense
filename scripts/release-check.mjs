// Check every public npm package (packages/*, not private) the way npm will see it: pack the real
// tarball with pnpm (which turns `workspace:^` into a version range) and inspect it.
//
//   node scripts/release-check.mjs           check the current dist/ folders (pnpm release:check)
//   node scripts/release-check.mjs --build   first clean dist/, build without the turbo cache,
//                                            typecheck, test and check the README samples
//   node scripts/release-check.mjs --strict  also fail on version 0.0.0 (not versioned yet)
//   node scripts/release-check.mjs --files   also print every file of every tarball
//
// `pnpm release:publish` runs it with --build --strict before `changeset publish`, so a stale or leaky
// build never reaches npm. It never publishes anything itself.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

/** Paths that must never be in a tarball. */
const FORBIDDEN = [
  [/\.map$/, "source map (its sources are not shipped)"],
  [/(^|\/)(src|test|tests|__tests__|fixtures?|scripts|registry|coverage)\//, "source, test or build folder"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, "test file"],
  [/(^|\/)\.env(\.|$)|\.dev\.vars$/, "environment file"],
  [/\.tsbuildinfo$|(^|\/)tsconfig[^/]*\.json$|(^|\/)vitest\.config\./, "build config"],
  [/(^|\/)(node_modules|\.turbo|\.wrangler)\//, "local folder"],
  [/(^|\/)\.DS_Store$/, "macOS metadata"],
];
const REQUIRED_FIELDS = [
  "description",
  "keywords",
  "homepage",
  "bugs",
  "repository",
  "license",
  "author",
  "engines",
];

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

function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? walk(path, base)
      : [{ path: relative(base, path), bytes: statSync(path).size }];
  });
}

function exportTargets(exports) {
  if (typeof exports === "string") return [exports];
  return Object.values(exports ?? {}).flatMap((value) => exportTargets(value));
}

function checkTarball(pkg, scratch) {
  const { manifest, path } = pkg;
  const problems = [];
  const output = run("pnpm", ["pack", "--pack-destination", scratch], { cwd: path });
  const tarball = output.trim().split("\n").pop();
  const unpacked = join(scratch, manifest.name.replace("/", "__"));
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", unpacked]);
  const root = join(unpacked, "package");
  const files = walk(root).sort((a, b) => a.path.localeCompare(b.path));
  const published = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  for (const file of files) {
    for (const [pattern, reason] of FORBIDDEN) {
      if (pattern.test(file.path)) problems.push(`${file.path}: ${reason}`);
    }
  }
  for (const name of ["package.json", "README.md", "LICENSE"]) {
    if (!files.some((file) => file.path === name)) problems.push(`${name} is missing`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (published[field] === undefined) problems.push(`package.json has no "${field}"`);
  }
  if (published.license !== "MIT") problems.push(`license is ${published.license}, expected MIT`);
  if (!published.repository?.directory) problems.push("repository.directory is missing");
  if (published.name.startsWith("@") && published.publishConfig?.access !== "public") {
    problems.push('a scoped package needs publishConfig.access "public"');
  }
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(published[field] ?? {})) {
      if (String(range).startsWith("workspace:")) problems.push(`${field}.${name} is still ${range}`);
    }
  }
  for (const target of [...exportTargets(published.exports), ...Object.values(published.bin ?? {})]) {
    if (!existsSync(join(root, target))) problems.push(`exports/bin target ${target} is not in the tarball`);
  }
  for (const [subpath, target] of Object.entries(published.exports ?? {})) {
    if (typeof target === "object" && target.default?.endsWith(".js") && !target.types) {
      problems.push(`exports["${subpath}"] has no types`);
    }
  }
  const unversioned = published.version === "0.0.0";
  const tarballBytes = statSync(tarball).size;
  const unpackedBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return { published, files, problems, unversioned, tarballBytes, unpackedBytes };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (args.has("--build")) {
  const packages = publicPackages();
  for (const { path } of packages) rmSync(join(path, "dist"), { recursive: true, force: true });
  const filters = packages.flatMap(({ manifest }) => ["--filter", manifest.name]);
  console.log("release-check: clean build, typecheck and test of the public packages");
  run("pnpm", ["exec", "turbo", "run", "build", "--force", ...filters], { stdio: "inherit" });
  run("pnpm", ["exec", "turbo", "run", "typecheck", "test", ...filters], { stdio: "inherit" });
  run("node", ["scripts/check-readmes.mjs"], { stdio: "inherit" });
}

const scratch = mkdtempSync(join(tmpdir(), "emojisense-release-"));
let failed = false;
try {
  console.log(
    `\n${"package".padEnd(28)} ${"version".padEnd(8)} ${"tarball".padStart(10)} ${"unpacked".padStart(10)} files`,
  );
  for (const pkg of publicPackages()) {
    const result = checkTarball(pkg, scratch);
    if (result.unversioned && args.has("--strict"))
      result.problems.push("version 0.0.0: run `pnpm release:version` first");
    failed ||= result.problems.length > 0;
    const mark = result.problems.length ? "✘" : "✔";
    console.log(
      `${mark} ${result.published.name.padEnd(26)} ${result.published.version.padEnd(8)} ${kb(result.tarballBytes).padStart(10)} ${kb(result.unpackedBytes).padStart(10)} ${result.files.length}`,
    );
    for (const problem of result.problems) console.log(`    ${problem}`);
    if (result.unversioned && !args.has("--strict")) {
      console.log("    note: version 0.0.0, run `pnpm release:version` before publishing");
    }
    if (args.has("--files"))
      for (const file of result.files) console.log(`    ${kb(file.bytes).padStart(10)}  ${file.path}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) {
  console.error("\nrelease-check: fix the problems above before publishing.");
  process.exit(1);
}
