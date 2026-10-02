import { type AliasEngine, createEngine, createLayeredSemantic, loadPacks } from "emojisense";
import { API_URL, PACK_BASE_URL, PACK_VERSION } from "./config";

let engine: Promise<AliasEngine> | undefined;

/**
 * The on-device engine with the English pack, loaded on first use: the pack (the heavy part)
 * downloads only when a page shows the live search.
 */
export function loadEngine(): Promise<AliasEngine> {
  if (!engine) {
    const loading = loadPacks({ baseUrl: PACK_BASE_URL, locales: ["en"] }).then((packs) =>
      createEngine(packs),
    );
    // A failed load (API down, offline) may be retried later.
    loading.catch(() => {
      engine = undefined;
    });
    engine = loading;
  }
  return engine;
}

/** Meaning search through the API. With a key, calls are metered to that key's app. */
export function semanticFor(key: string | undefined) {
  return createLayeredSemantic({ endpoint: API_URL, packVersion: PACK_VERSION, ...(key ? { key } : {}) });
}
