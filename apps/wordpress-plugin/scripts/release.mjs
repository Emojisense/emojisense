/**
 * Stages the plugin as WordPress installs it (release/emojisense/) and zips it
 * (release/emojisense-<version>.zip). Run `pnpm build` first. Nothing is uploaded.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = join(PLUGIN, "release");
const STAGE = join(RELEASE, "emojisense");

/** Everything WordPress needs; sources, tests and dev tools stay out. */
const FILES = ["emojisense.php", "uninstall.php", "readme.txt"];
const DIRS = ["includes", "build", "packs", "languages", "licenses"];
/** Files that must exist, so a zip without a build or without data never ships. */
const REQUIRED = [
  "build/editor.js",
  "build/editor.asset.php",
  "build/classic.js",
  "build/comments.js",
  "build/reactions.js",
  "build/admin.js",
  "packs/0.1.0/pack.en.json",
  "packs/0.1.0/pack.en.ext.json",
  "packs/culture/0.1.0/culture.en.json",
  "languages/emojisense.pot",
  "licenses/emojisense.MIT.txt",
];

async function versions() {
  const php = await readFile(join(PLUGIN, "emojisense.php"), "utf8");
  const readme = await readFile(join(PLUGIN, "readme.txt"), "utf8");
  const pkg = JSON.parse(await readFile(join(PLUGIN, "package.json"), "utf8"));
  const header = /\* Version:\s+(\S+)/.exec(php)?.[1];
  const constant = /define\( 'EMOJISENSE_VERSION', '([^']+)' \)/.exec(php)?.[1];
  const stable = /^Stable tag:\s+(\S+)/m.exec(readme)?.[1];
  const all = { header, constant, stable, package: pkg.version };
  if (new Set(Object.values(all)).size !== 1) {
    throw new Error(`version mismatch: ${JSON.stringify(all)}`);
  }
  return pkg.version;
}

async function main() {
  const version = await versions();
  for (const file of REQUIRED) {
    await stat(join(PLUGIN, file)).catch(() => {
      throw new Error(`${file} is missing: run \`pnpm build\` (and \`pnpm data:build\` at the root)`);
    });
  }

  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });
  for (const file of FILES) await cp(join(PLUGIN, file), join(STAGE, file));
  for (const dir of DIRS) await cp(join(PLUGIN, dir), join(STAGE, dir), { recursive: true });

  const zip = join(RELEASE, `emojisense-${version}.zip`);
  await rm(zip, { force: true });
  // -X: no extra file attributes, so the zip is the same on every machine.
  execFileSync("zip", ["-r", "-X", "-q", zip, "emojisense", "-x", "*.DS_Store"], { cwd: RELEASE });
  const { size } = await stat(zip);
  console.log(`release: ${zip} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

await main();
