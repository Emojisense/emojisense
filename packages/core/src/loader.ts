import { assertPack, isCustomPack, type Pack } from "./pack.js";

export interface LoadPacksOptions {
  /** Base URL of a pack version, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  baseUrl: string;
  /** Locales to load. English is always loaded first: it carries shortcodes. */
  locales?: string[];
  /** "core" (default) = first-render packs; "ext" = the idle-time extension packs. */
  part?: "core" | "ext";
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
  const { baseUrl, locales = ["en"], signal, part = "core" } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const ordered = ["en", ...locales.filter((l) => l !== "en")];
  return Promise.all(
    ordered.map(async (locale) => {
      const file = part === "ext" ? `pack.${locale}.ext.json` : `pack.${locale}.json`;
      const hash = options.crossOriginStorage?.hashes[file];
      const shared = hash ? await viaCrossOriginStorage(hash) : undefined;
      let pack: unknown = shared;
      if (!pack) {
        const response = await doFetch(`${baseUrl.replace(/\/+$/, "")}/${file}`, { signal: signal ?? null });
        if (!response.ok) throw new Error(`emojisense: ${file} failed with HTTP ${response.status}`);
        pack = await response.json();
      }
      assertPack(pack);
      return pack;
    }),
  );
}

export interface LoadCustomPackOptions {
  /** Base URL of the Emojisense API, e.g. "https://api.emojisense.com". */
  endpoint: string;
  /** Publishable key (`pk_…`). The custom emoji of its app are loaded. */
  key: string;
  /** The app owner's id for one of their customers (tenant): adds that tenant's emoji. */
  tenant?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Fetch the app's custom emoji as a pack (GET /v1/custom-pack). Pass it to `createEngine` after
 * the locale packs, so custom emoji are searched on the device too. The edge caches it for 60 s.
 */
export async function loadCustomPack(options: LoadCustomPackOptions): Promise<Pack> {
  const { endpoint, key, tenant, signal } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const params = new URLSearchParams({ key });
  if (tenant) params.set("tenant", tenant);
  const url = `${endpoint.replace(/\/+$/, "")}/v1/custom-pack?${params}`;
  const response = await doFetch(url, { signal: signal ?? null });
  if (!response.ok) throw new Error(`emojisense: custom pack request failed with HTTP ${response.status}`);
  const pack: unknown = await response.json();
  assertPack(pack);
  if (!isCustomPack(pack)) throw new Error("emojisense: not a custom emoji pack");
  return pack;
}
