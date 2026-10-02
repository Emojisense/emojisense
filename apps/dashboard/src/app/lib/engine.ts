import type { AliasEngine } from "emojisense";
import { API_URL, PACK_BASE_URL, PACK_VERSION } from "./config";

type EmojisenseModule = typeof import("emojisense");

export interface SearchKit {
  engine: AliasEngine;
  sdk: EmojisenseModule;
}

let kit: Promise<SearchKit> | undefined;

/**
 * The on-device engine with the English pack, loaded on first use. The `emojisense` package is
 * imported lazily, so pages without a search box never download it.
 */
export function loadSearchKit(): Promise<SearchKit> {
  if (!kit) {
    const loading = import("emojisense").then(async (sdk) => ({
      sdk,
      engine: sdk.createEngine(await sdk.loadPacks({ baseUrl: PACK_BASE_URL, locales: ["en"] })),
    }));
    // A failed load (API down, offline) may be retried later.
    loading.catch(() => {
      kit = undefined;
    });
    kit = loading;
  }
  return kit;
}

/** Meaning search through the API. With a key, calls are metered to that key's app. */
export function semanticFor(sdk: EmojisenseModule, key: string | undefined) {
  return sdk.createLayeredSemantic({ endpoint: API_URL, packVersion: PACK_VERSION, ...(key ? { key } : {}) });
}
