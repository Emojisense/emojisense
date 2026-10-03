import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AliasEngine, assertPack, createEngine, type Pack } from "emojisense";

/** `assets/packs/index.json`, written by `scripts/bundle-packs.mts`. */
interface PackIndex {
  packVersion: string;
  /** Pack files in index order: core parts first (English first), then the ext parts. */
  files: string[];
}

function readIndex(dir: string): PackIndex {
  try {
    return JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as PackIndex;
  } catch (error) {
    throw new Error(`No emoji data in ${dir}. Run "pnpm build" in apps/raycast first.`, { cause: error });
  }
}

/** "pack.tr.ext.json" → "tr". */
function localeOfFile(file: string): string | undefined {
  return /^pack\.([a-z-]+)(?:\.ext)?\.json$/.exec(file)?.[1];
}

/** Locales with a bundled pack, in index order (English first). */
export function bundledLocales(dir: string): string[] {
  const locales = readIndex(dir).files.map(localeOfFile);
  return [...new Set(locales.filter((locale) => locale !== undefined))];
}

/** Read and validate the bundled packs of `locales` (default: all of them), in index order. */
export function loadPacks(dir: string, locales?: readonly string[]): Pack[] {
  return readIndex(dir)
    .files.filter((file) => !locales || locales.includes(localeOfFile(file) ?? ""))
    .map((file) => {
      const pack: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      assertPack(pack);
      return pack;
    });
}

let cached: { key: string; engine: AliasEngine } | undefined;

/**
 * The engine for the user's languages. The other bundled packs stay on disk: the index is smaller,
 * and a phrase in a language the user does not read never matches. Building the index takes a few
 * hundred milliseconds, so it is kept for as long as Raycast keeps the extension loaded.
 */
export function getEngine(dir: string, locales: readonly string[]): AliasEngine {
  const key = `${dir}\n${locales.join(",")}`;
  if (cached?.key !== key) cached = { key, engine: createEngine(loadPacks(dir, locales)) };
  return cached.engine;
}
