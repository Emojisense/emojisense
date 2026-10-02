import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AliasEngine, assertPack, createEngine, type Pack } from "emojisense";

/** `assets/packs/index.json`, written by `scripts/bundle-packs.mts`. */
interface PackIndex {
  packVersion: string;
  /** Pack files in index order: core parts first (English first), then the ext parts. */
  files: string[];
}

/** Read and validate the packs that ship with the extension. */
export function loadPacks(dir: string): Pack[] {
  let index: PackIndex;
  try {
    index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as PackIndex;
  } catch (error) {
    throw new Error(`No emoji data in ${dir}. Run "pnpm build" in apps/raycast first.`, { cause: error });
  }
  return index.files.map((file) => {
    const pack: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    assertPack(pack);
    return pack;
  });
}

let cached: { dir: string; engine: AliasEngine } | undefined;

/**
 * The engine for the bundled packs. Building the index takes a few hundred milliseconds, so it is
 * kept for as long as Raycast keeps the extension loaded.
 */
export function getEngine(dir: string): AliasEngine {
  if (cached?.dir !== dir) cached = { dir, engine: createEngine(loadPacks(dir)) };
  return cached.engine;
}
