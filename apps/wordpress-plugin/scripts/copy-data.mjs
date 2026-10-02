/**
 * Copies the data the plugin serves from its own folder: the locale packs (core and extension),
 * the culture files and the license texts. Run after `pnpm data:build` (packages/data/dist).
 */
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PLUGIN, "..", "..");
const DATA = join(REPO, "packages", "data");

/** Must match EMOJISENSE_PACK_VERSION in emojisense.php. */
const PACK_VERSION = "0.1.0";

async function main() {
  const plugin = await readFile(join(PLUGIN, "emojisense.php"), "utf8");
  if (!plugin.includes(`define( 'EMOJISENSE_PACK_VERSION', '${PACK_VERSION}' );`)) {
    throw new Error(`emojisense.php does not declare pack version ${PACK_VERSION}`);
  }

  const packSource = join(DATA, "dist", "packs", PACK_VERSION);
  const cultureSource = join(DATA, "dist", "culture", PACK_VERSION);
  const packTarget = join(PLUGIN, "packs", PACK_VERSION);
  const cultureTarget = join(PLUGIN, "packs", "culture", PACK_VERSION);
  await rm(join(PLUGIN, "packs"), { recursive: true, force: true });
  await mkdir(packTarget, { recursive: true });
  await mkdir(cultureTarget, { recursive: true });

  // Vectors and shards are for the API; the browser searches the alias packs only.
  const packs = (await readdir(packSource)).filter((file) => /^pack\.[a-z]{2,3}(\.ext)?\.json$/.test(file));
  if (packs.length === 0) throw new Error(`no packs in ${packSource}: run \`pnpm data:build\` first`);
  for (const file of [...packs, "manifest.json"])
    await copyFile(join(packSource, file), join(packTarget, file));

  const cultures = (await readdir(cultureSource)).filter((file) => file.endsWith(".json"));
  for (const file of cultures) await copyFile(join(cultureSource, file), join(cultureTarget, file));

  const licenses = join(PLUGIN, "licenses");
  await rm(licenses, { recursive: true, force: true });
  await mkdir(licenses, { recursive: true });
  for (const file of await readdir(join(DATA, "licenses"))) {
    if (file.endsWith(".txt")) await copyFile(join(DATA, "licenses", file), join(licenses, file));
  }
  await copyFile(join(REPO, "LICENSE"), join(licenses, "emojisense.MIT.txt"));

  console.log(`copy-data: ${packs.length} packs, ${cultures.length} culture files, licenses`);
}

await main();
