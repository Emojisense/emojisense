/**
 * Copy the current pack version from packages/data into assets/packs/, with the data license
 * notices. Raycast ships the assets folder with the extension, so search works offline with no
 * download.
 *
 *   tsx scripts/bundle-packs.mts
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_ROOT } from "@emojisense/data/paths";

const { packVersion } = JSON.parse(readFileSync(join(DATA_ROOT, "pack.config.json"), "utf8")) as {
  packVersion: string;
};
const source = join(DATA_ROOT, "dist", "packs", packVersion);
if (!existsSync(source)) throw new Error(`${source} not found. Build the data packs first: pnpm data:build`);

const CORE = /^pack\.([a-z-]+)\.json$/;
const EXT = /^pack\.([a-z-]+)\.ext\.json$/;
// Index order from PACK_FORMAT.md: every core part first (English first), then the ext parts.
const englishFirst = (a: string, b: string) =>
  Number(b.startsWith("pack.en.")) - Number(a.startsWith("pack.en.")) || a.localeCompare(b);
const available = readdirSync(source);
const files = [
  ...available.filter((f) => CORE.test(f)).sort(englishFirst),
  ...available.filter((f) => EXT.test(f)).sort(englishFirst),
];
if (files.length === 0) throw new Error(`${source} has no pack files`);

const target = fileURLToPath(new URL("../assets/packs/", import.meta.url));
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(source, file), join(target, file));
writeFileSync(join(target, "index.json"), `${JSON.stringify({ packVersion, files }, null, 2)}\n`);

// The Unicode license asks for its notice in every copy of the data.
const licenses = join(DATA_ROOT, "licenses");
mkdirSync(join(target, "licenses"), { recursive: true });
for (const file of readdirSync(licenses)) copyFileSync(join(licenses, file), join(target, "licenses", file));
console.log(`bundle-packs: ${files.length} files of pack ${packVersion} + data licenses → assets/packs`);
