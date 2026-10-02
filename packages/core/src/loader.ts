import { assertPack, type Pack } from "./pack.js";

export interface LoadPacksOptions {
  /** Base URL of a pack version, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  baseUrl: string;
  /** Locales to load. English is always loaded first: it carries shortcodes. */
  locales?: string[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Experimental: try the Cross-Origin Storage API (WICG proposal, not shipped in any browser
   * as of 2026-10) so one download can be shared across sites. Requires `sha256` per file.
   */
  crossOriginStorage?: { hashes: Record<string, string> };
}

interface CrossOriginStorage {
  requestFileHandles(
    hashes: { algorithm: "SHA-256"; value: string }[],
  ): Promise<{ getFile(): Promise<Blob> }[]>;
}

async function viaCrossOriginStorage(sha256: string): Promise<Pack | undefined> {
  const storage = (globalThis.navigator as unknown as { crossOriginStorage?: CrossOriginStorage } | undefined)
    ?.crossOriginStorage;
  if (!storage) return undefined;
  try {
    const [handle] = await storage.requestFileHandles([{ algorithm: "SHA-256", value: sha256 }]);
    return handle ? (JSON.parse(await (await handle.getFile()).text()) as Pack) : undefined;
  } catch {
    return undefined;
  }
}

/** Fetch and validate locale packs. Files are immutable, so the HTTP cache does the rest. */
export async function loadPacks(options: LoadPacksOptions): Promise<Pack[]> {
  const { baseUrl, locales = ["en"], signal } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const ordered = ["en", ...locales.filter((l) => l !== "en")];
  return Promise.all(
    ordered.map(async (locale) => {
      const file = `pack.${locale}.json`;
      const hash = options.crossOriginStorage?.hashes[file];
      const shared = hash ? await viaCrossOriginStorage(hash) : undefined;
      const pack: unknown =
        shared ??
        (await (await doFetch(`${baseUrl.replace(/\/+$/, "")}/${file}`, { signal: signal ?? null })).json());
      assertPack(pack);
      return pack;
    }),
  );
}
