import { decodeVectors, type VectorIndex } from "emojisense/vectors";
import type { Env } from "./env.ts";

/** Reads one published vector file (e.g. `vectors.bge-m3.1024.es.bin`) of the Worker's pack version. */
export type VectorReader = (file: string, env: Env) => Promise<VectorIndex>;

/** The vector indexes a query of one locale searches (PACK_FORMAT §5). */
export interface LocaleIndexes {
  /** The shared (English) index, then the locale's own when it has one and it is loaded. */
  indexes: VectorIndex[];
  /** False when the locale has a vector file that could not be loaded now. */
  complete: boolean;
}

export interface LocaleVectorsOptions {
  /** The bundled shared index. */
  shared: () => VectorIndex;
  /** Locales with their own vector file (generated config.json). */
  locales: readonly string[];
  fileOf: (locale: string) => string;
  read: VectorReader;
  /** Locale indexes kept per isolate; the least recently used one is dropped. */
  maxResident: number;
}

export interface LocaleVectors {
  get(locale: string, env: Env): Promise<LocaleIndexes>;
  /** Locales with an index in memory or loading, least recently used first. */
  readonly resident: string[];
}

/**
 * Per-locale emoji vectors. The shared index is bundled; a locale's own index is read through
 * ASSETS on first use and kept in a small per-isolate LRU (≈ 8 MB each at 1,914 × 1024; DECISIONS.md,
 * "Multilingual semantic tier"). Concurrent requests share one load. A failed load is not kept:
 * that request searches the shared index only, and the next one tries again.
 */
export function createLocaleVectors(options: LocaleVectorsOptions): LocaleVectors {
  const loaded = new Map<string, Promise<VectorIndex | undefined>>();

  function load(locale: string, env: Env): Promise<VectorIndex | undefined> {
    const started = Date.now();
    const loading: Promise<VectorIndex | undefined> = options
      .read(options.fileOf(locale), env)
      .then((index) => {
        console.log(
          JSON.stringify({
            event: "locale_vectors_loaded",
            locale,
            ms: Date.now() - started,
            resident: loaded.size,
          }),
        );
        return index;
      })
      .catch((error: Error) => {
        if (loaded.get(locale) === loading) loaded.delete(locale);
        console.warn(
          JSON.stringify({
            event: "locale_vectors_unavailable",
            locale,
            error: error.name,
            message: error.message,
          }),
        );
        return undefined;
      });
    return loading;
  }

  return {
    async get(locale, env) {
      const shared = options.shared();
      if (!options.locales.includes(locale)) return { indexes: [shared], complete: true };
      const index = loaded.get(locale) ?? load(locale, env);
      // Map order is insertion order: re-inserting marks the locale as the most recently used.
      loaded.delete(locale);
      loaded.set(locale, index);
      for (const oldest of loaded.keys()) {
        if (loaded.size <= options.maxResident) break;
        loaded.delete(oldest);
      }
      const own = await index;
      return own ? { indexes: [shared, own], complete: true } : { indexes: [shared], complete: false };
    },
    get resident() {
      return [...loaded.keys()];
    },
  };
}

/**
 * Reads vector files from the Worker's static assets (`/v1/pack/<version>/…`) through the ASSETS
 * binding, and checks that they hold the model and dims the Worker embeds queries with.
 */
export function assetVectorReader(
  packVersion: string,
  expected: { model: string; dims: number },
): VectorReader {
  return async (file, env) => {
    if (!env.ASSETS) throw new Error("ASSETS binding missing");
    const response = await env.ASSETS.fetch(`https://assets.local/v1/pack/${packVersion}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const index = decodeVectors(await response.arrayBuffer());
    if (index.model !== expected.model || index.dims !== expected.dims) {
      throw new Error(
        `${file} holds ${index.model}@${index.dims}, expected ${expected.model}@${expected.dims}`,
      );
    }
    return index;
  };
}
