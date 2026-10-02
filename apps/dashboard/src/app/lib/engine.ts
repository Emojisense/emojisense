import { type AliasEngine, createEngine, createLayeredSemantic, loadPacks } from "emojisense";
import { API_URL, PACK_BASE_URL, PACK_VERSION } from "./config";

let engine: Promise<AliasEngine> | undefined;

/** A pack that has not arrived by then counts as failed, so the page can offer a retry. */
const PACK_TIMEOUT_MS = 15_000;

/**
 * The on-device engine with the English pack, loaded on first use: the pack (the heavy part)
 * downloads only when a page shows the live search.
 */
export function loadEngine(): Promise<AliasEngine> {
  if (!engine) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PACK_TIMEOUT_MS);
    const loading = loadPacks({ baseUrl: PACK_BASE_URL, locales: ["en"], signal: controller.signal })
      .then((packs) => createEngine(packs))
      .finally(() => clearTimeout(timer));
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
