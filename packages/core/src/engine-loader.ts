import { type Culture, cultureUrlFor, loadCulture } from "./culture.js";
import { type AliasEngine, createEngine } from "./engine.js";
import { createLayeredSemantic } from "./layered.js";
import type { Pack } from "./pack.js";
import { whenQuiet as defaultWhenQuiet, type PackIndexState, sharedPackIndex } from "./pack-index.js";
import type { SemanticProvider } from "./provider.js";

export interface EngineLoaderOptions {
  /** Base URL of a pack version, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  packUrl: string;
  /** Pack locale ("tr"). English always loads too, and alone when the locale has no pack. */
  locale?: string | undefined;
  /**
   * Culture files of the pack version. Default: the culture directory next to `packUrl`
   * (".../v1/pack/0.1.0" → ".../v1/culture/0.1.0"). `false`: no culture layer. A failed load
   * (or a locale without a file) leaves the layer off and search works as before.
   */
  cultureUrl?: string | false | undefined;
  /** Packs to add to every engine, e.g. a custom emoji pack. */
  extraPacks?: readonly Pack[] | undefined;
  /** Load the extension packs (more aliases and typos) after the core packs. Default true. */
  extended?: boolean | undefined;
  fetch?: typeof fetch;
  /** Starts the extension download when the browser is idle. Tests pass a synchronous one. */
  whenIdle?: (task: () => void) => void;
  /** Builds the extension index in a pause in typing. Tests pass a synchronous one. */
  whenQuiet?: (task: () => void) => void;
}

/**
 * Loads the packs on first use: the core packs, then the extension packs (more aliases and
 * typos). Loaders with the same `packUrl`, `locale`, `extended` and `fetch` share one download and
 * one index, so a second editor or a picker that opens again gets its engine at once. The culture
 * file never delays the first engine: it is added when it arrives. Listeners hear about each
 * engine.
 */
export interface EngineLoader {
  /** The engine; starts loading on the first call. Rejects when the core packs fail. */
  load(): Promise<AliasEngine>;
  /**
   * Starts loading without waiting, e.g. when the pointer moves onto or focus enters the button
   * that opens search. Errors are left to `load`.
   */
  preload(): void;
  /** The newest engine, or undefined before the core packs arrived. */
  current(): AliasEngine | undefined;
  /** The locale packs in the newest engine: core, then core + extension. Extra packs are not included. */
  packs(): readonly Pack[];
  /**
   * Called with each new engine: core, core + extension, and each with the culture file once it
   * is there. Returns an unsubscribe function.
   */
  subscribe(listener: (engine: AliasEngine) => void): () => void;
}

const defaultWhenIdle = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(task, { timeout: 4000 });
  else setTimeout(task, 1000);
};

export function createEngineLoader(options: EngineLoaderOptions): EngineLoader {
  const { packUrl, locale = "en", extraPacks = [], extended = true } = options;
  const cultureUrl =
    options.cultureUrl === false ? undefined : (options.cultureUrl ?? cultureUrlFor(packUrl));
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const index = sharedPackIndex({
    packUrl,
    locale,
    extended,
    fetch: options.fetch,
    whenIdle: options.whenIdle ?? defaultWhenIdle,
    whenQuiet: options.whenQuiet ?? defaultWhenQuiet,
  });
  const listeners = new Set<(engine: AliasEngine) => void>();
  let stopListening: (() => void) | undefined;
  let culture: Culture | undefined;
  let cultureLocale: string | undefined;
  let withExtras: { from: PackIndexState; engine: AliasEngine } | undefined;
  let latest: { from: PackIndexState; culture: Culture | undefined; engine: AliasEngine } | undefined;
  let notified: AliasEngine | undefined;

  const current = (): AliasEngine | undefined => {
    const from = index.current();
    if (!from) return undefined;
    if (latest?.from === from && latest.culture === culture) return latest.engine;
    let base = from.engine;
    if (extraPacks.length > 0) {
      if (withExtras?.from !== from) {
        withExtras = { from, engine: createEngine([...from.packs, ...extraPacks]) };
      }
      base = withExtras.engine;
    }
    // withCulture shares the index: a culture file that arrives later costs no rebuild.
    latest = { from, culture, engine: culture ? base.withCulture(culture) : base };
    return latest.engine;
  };

  const notify = () => {
    const engine = current();
    if (!engine || engine === notified) return;
    notified = engine;
    for (const listener of listeners) listener(engine);
  };

  const requestCulture = (fileLocale: string) => {
    if (!cultureUrl || cultureLocale === fileLocale) return;
    cultureLocale = fileLocale;
    loadCulture({ baseUrl: cultureUrl, locale: fileLocale, fetch: doFetch }).then(
      (file) => {
        if (cultureLocale !== fileLocale) return;
        culture = file;
        notify();
      },
      () => {
        // The culture layer only adds results; search works the same without it.
      },
    );
  };

  const load = (): Promise<AliasEngine> => {
    requestCulture(locale);
    return index.load().then((state) => {
      // Culture follows the packs: a locale that fell back to English gets the English file.
      requestCulture(state.engine.locales.includes(locale) ? locale : "en");
      notify();
      return current() as AliasEngine;
    });
  };

  return {
    load,
    preload() {
      load().catch(() => {
        // `load` reports the error to whoever waits for the engine.
      });
    },
    current,
    packs: () => index.current()?.packs ?? [],
    subscribe(listener) {
      listeners.add(listener);
      stopListening ??= index.subscribe(notify);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopListening?.();
        stopListening = undefined;
      };
    },
  };
}

export interface ApiSemanticOptions {
  /** The Emojisense API, e.g. "https://api.emojisense.com". Without it there is no semantic layer. */
  endpoint?: string | undefined;
  /** Publishable key (`pk_…`). */
  key?: string | undefined;
  packVersion: string;
  fetch?: typeof fetch;
}

/**
 * The API host's shards (free static files with precomputed answers), then the metered API, as one
 * semantic provider. `undefined` without an endpoint: search stays on the device.
 */
export function createApiSemantic(options: ApiSemanticOptions): SemanticProvider | undefined {
  const { endpoint, key, packVersion, fetch } = options;
  if (!endpoint) return undefined;
  const base = endpoint.replace(/\/+$/, "");
  return createLayeredSemantic({
    shardsUrl: `${base}/p/${packVersion}`,
    endpoint: base,
    packVersion,
    ...(key ? { key } : {}),
    ...(fetch ? { fetch } : {}),
  });
}
