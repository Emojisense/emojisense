/**
 * Builds the Discourse theme component in dist/theme: the theme files, the TypeScript bundled into
 * one ES module, and the packs and culture files as theme assets. Run after `pnpm data:build`.
 *
 *   pnpm --filter @emojisense/discourse build
 *
 * Discourse installs a theme from the root of a git repository, so dist/theme is what
 * `scripts/release-discourse.sh` publishes as the theme repository.
 */
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(APP, "..", "..");
const DATA = join(REPO, "packages", "data");
const OUT = join(APP, "dist", "theme");
const PACK_VERSION = "0.1.0";

/** Discourse limits: 1 MiB per JavaScript file of a theme, 8 MB per file in a git import. */
const MAX_SCRIPT = 1024 * 1024;
const MAX_ASSET = 8 * 1000 * 1000;

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await cp(join(APP, "theme"), OUT, { recursive: true });

  const script = join(OUT, "javascripts", "discourse", "lib", "emojisense.js");
  await build({
    entryPoints: [join(APP, "src", "index.ts")],
    outfile: script,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    banner: { js: "// Emojisense for Discourse: built from apps/discourse/src. MIT." },
  });
  const scriptSize = (await stat(script)).size;
  if (scriptSize > MAX_SCRIPT)
    throw new Error(`emojisense.js is ${scriptSize} bytes, over Discourse's 1 MiB`);

  // The theme accepts .js assets, not .json: the files keep their JSON text under a .js name.
  const assets = {};
  const copyAsset = async (source, file, name) => {
    const target = join(OUT, "assets", `${file}.js`);
    await copyFile(source, target);
    const { size } = await stat(target);
    if (size > MAX_ASSET) throw new Error(`${file} is ${size} bytes, over Discourse's 8 MB per file`);
    assets[name] = `assets/${file}.js`;
  };
  await mkdir(join(OUT, "assets"), { recursive: true });
  const packDir = join(DATA, "dist", "packs", PACK_VERSION);
  const packs = (await readdir(packDir)).filter((file) => /^pack\.[a-z]{2}(\.ext)?\.json$/.test(file));
  if (packs.length === 0) throw new Error(`no packs in ${packDir}: run \`pnpm data:build\` first`);
  for (const file of packs.sort()) {
    const [, locale, ext] = /^pack\.([a-z]{2})(\.ext)?\.json$/.exec(file) ?? [];
    await copyAsset(join(packDir, file), file, `pack_${locale}${ext ? "_ext" : ""}`);
  }
  const cultureDir = join(DATA, "dist", "culture", PACK_VERSION);
  for (const file of (await readdir(cultureDir))
    .filter((name) => /^culture\.[a-z]{2}\.json$/.test(name))
    .sort()) {
    await copyAsset(join(cultureDir, file), file, `culture_${file.slice(8, 10)}`);
  }

  const about = JSON.parse(await readFile(join(OUT, "about.json"), "utf8"));
  about.assets = assets;
  await writeFile(join(OUT, "about.json"), `${JSON.stringify(about, null, 2)}\n`);

  await mkdir(join(OUT, "licenses"), { recursive: true });
  for (const file of await readdir(join(DATA, "licenses"))) {
    if (file.endsWith(".txt")) await copyFile(join(DATA, "licenses", file), join(OUT, "licenses", file));
  }
  await copyFile(join(REPO, "LICENSE"), join(OUT, "LICENSE"));
  await copyFile(join(APP, "README.md"), join(OUT, "README.md"));

  const total = Object.keys(assets).length;
  console.log(
    `discourse: dist/theme (emojisense.js ${(scriptSize / 1024).toFixed(1)} KB, ${total} data assets)`,
  );
}

await main();
