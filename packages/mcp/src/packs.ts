import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPack, type Pack } from "emojisense";

/** `packs/index.json`, written by `scripts/bundle-packs.ts` at build time. */
export interface PackIndex {
  packVersion: string;
  /** Pack files in index order: every core part first (English first), then the ext parts. */
  files: string[];
}

/** Where the build puts the packs: `dist/packs/`, next to the compiled modules. */
export const BUNDLED_PACKS_DIR = fileURLToPath(new URL("./packs/", import.meta.url));

/** Read and validate the packs bundled with the package. No network: the server works offline. */
export function loadBundledPacks(dir: string = BUNDLED_PACKS_DIR): Pack[] {
  let index: PackIndex;
  try {
    index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as PackIndex;
  } catch (error) {
    throw new Error(`emojisense-mcp: no bundled packs in ${dir}. Run the package build first.`, {
      cause: error,
    });
  }
  return index.files.map((file) => {
    const pack: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    assertPack(pack);
    return pack;
  });
}
