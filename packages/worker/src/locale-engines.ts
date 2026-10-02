import { type AliasEngine, assertPack, createEngine, type Pack } from "emojisense";
import type { Env } from "./env.ts";

/** Reads one published pack file (e.g. `pack.es.json`) of the Worker's pack version. */
export type PackReader = (file: string, env: Env) => Promise<Pack>;

export interface LocaleEnginesOptions {
  /** The bundled engine (en + tr, core + ext). It serves the locales it was built with. */
  bundled: () => AliasEngine;
  /** Packs every other locale's engine starts with: the English core pack (shortcodes). */
  base: () => Pack[];
  read: PackReader;
  /** Engines of non-bundled locales kept per isolate; the least recently used one is dropped. */
  maxEngines: number;
}

export interface LocaleEngines {
  /** The engine whose aliases rank `locale`; undefined when its pack cannot be loaded now. */
  get(locale: string, env: Env): Promise<AliasEngine | undefined>;
  /** Non-bundled locales with an engine in memory or loading, least recently used first. */
  readonly resident: string[];
}

/**
 * Alias engines per locale. Locales outside the bundle load their core pack on first use and
 * stay in a small per-isolate LRU (memory budget: DECISIONS.md, "Server-side aliases for every
 * pack locale"). Concurrent requests share one load. A failed load is not kept: the caller ranks
 * without aliases this time, and the next request tries again.
 */
export function createLocaleEngines(options: LocaleEnginesOptions): LocaleEngines {
  const engines = new Map<string, Promise<AliasEngine | undefined>>();

  async function build(locale: string, env: Env): Promise<AliasEngine> {
    const started = Date.now();
    const pack = await options.read(`pack.${locale}.json`, env);
    if (pack.locale !== locale) throw new Error(`pack.${locale}.json holds locale "${pack.locale}"`);
    const readMs = Date.now() - started;
    const engine = createEngine([...options.base(), pack]);
    console.log(
      JSON.stringify({
        event: "locale_engine_loaded",
        locale,
        readMs,
        buildMs: Date.now() - started - readMs,
        resident: engines.size,
      }),
    );
    return engine;
  }

  function load(locale: string, env: Env): Promise<AliasEngine | undefined> {
    const loading: Promise<AliasEngine | undefined> = build(locale, env).catch((error: Error) => {
      if (engines.get(locale) === loading) engines.delete(locale);
      console.warn(
        JSON.stringify({
          event: "locale_pack_unavailable",
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
      const bundled = options.bundled();
      if (bundled.locales.includes(locale)) return bundled;
      const engine = engines.get(locale) ?? load(locale, env);
      // Map order is insertion order: re-inserting marks the locale as the most recently used.
      engines.delete(locale);
      engines.set(locale, engine);
      for (const oldest of engines.keys()) {
        if (engines.size <= options.maxEngines) break;
        engines.delete(oldest);
      }
      return engine;
    },
    get resident() {
      return [...engines.keys()];
    },
  };
}

/**
 * Reads packs from the Worker's static assets (`/v1/pack/<version>/…`) through the ASSETS
 * binding: the same immutable files clients load, without a network hop or a Worker invocation.
 */
export function assetPackReader(packVersion: string): PackReader {
  return async (file, env) => {
    if (!env.ASSETS) throw new Error("ASSETS binding missing");
    const response = await env.ASSETS.fetch(`https://assets.local/v1/pack/${packVersion}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const pack: unknown = await response.json();
    assertPack(pack);
    if (pack.packVersion !== packVersion) {
      throw new Error(`${file} is pack ${pack.packVersion}, the Worker serves ${packVersion}`);
    }
    return pack;
  };
}
