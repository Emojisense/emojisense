import { type Culture, cultureUrlFor, loadCulture } from "./culture.js";
import { type AliasEngine, createEngine } from "./engine.js";
import { createLayeredSemantic } from "./layered.js";
import { loadPacks } from "./loader.js";
import type { Pack } from "./pack.js";
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
  fetch?: typeof fetch;
  /** Runs a task when the browser is idle. Tests pass a synchronous one. */
  whenIdle?: (task: () => void) => void;
}

/**
 * Loads the packs once, on first use: the core packs first, then the extension packs (more
 * aliases and typos) when the browser is idle. Listeners hear about each engine.
 */
export interface EngineLoader {
  /** The engine; starts loading on the first call. Rejects when the core packs fail. */
  load(): Promise<AliasEngine>;
  /** The newest engine, or undefined before the core packs arrived. */
  current(): AliasEngine | undefined;
  /** Called with each new engine (core, then core + extension). Returns an unsubscribe function. */
  subscribe(listener: (engine: AliasEngine) => void): () => void;
}

const defaultWhenIdle = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(task, { timeout: 4000 });
  else setTimeout(task, 1000);
};

export function createEngineLoader(options: EngineLoaderOptions): EngineLoader {
  const { packUrl, locale = "en", extraPacks = [], whenIdle = defaultWhenIdle } = options;
  const cultureUrl =
    options.cultureUrl === false ? undefined : (options.cultureUrl ?? cultureUrlFor(packUrl));
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<(engine: AliasEngine) => void>();
  let engine: AliasEngine | undefined;
  let loading: Promise<AliasEngine> | undefined;

  const publish = (next: AliasEngine) => {
    engine = next;
    for (const listener of listeners) listener(next);
  };

  const culture = (fileLocale: string): Promise<Culture | undefined> =>
    cultureUrl
      ? loadCulture({ baseUrl: cultureUrl, locale: fileLocale, fetch: doFetch }).catch(() => undefined)
      : Promise.resolve(undefined);

  const corePacks = async (): Promise<{ packs: Pack[]; locales: string[] }> => {
    try {
      return {
        packs: await loadPacks({ baseUrl: packUrl, locales: [locale], fetch: doFetch }),
        locales: [locale],
      };
    } catch (error) {
      if (locale === "en") throw error;
      // A locale without a pack (a site language Emojisense does not cover) still gets English.
      return { packs: await loadPacks({ baseUrl: packUrl, fetch: doFetch }), locales: ["en"] };
    }
  };

  const start = async (): Promise<AliasEngine> => {
    const wanted = culture(locale);
    const { packs: core, locales } = await corePacks();
    // Culture follows the packs: a locale that fell back to English gets the English file.
    const cultureFile = locales[0] === locale ? await wanted : await culture(locales[0] as string);
    const engineOptions = cultureFile ? { culture: cultureFile } : {};
    const first = createEngine([...core, ...extraPacks], engineOptions);
    publish(first);
    whenIdle(() => {
      loadPacks({ baseUrl: packUrl, locales, fetch: doFetch, part: "ext" }).then(
        (ext) => publish(createEngine([...core, ...ext, ...extraPacks], engineOptions)),
        () => {
          // Optional upgrade: the core packs keep working.
        },
      );
    });
    return first;
  };

  return {
    load() {
      if (!loading) {
        loading = start();
        // A failed load may be retried (the network or the site may be back).
        loading.catch(() => {
          loading = undefined;
        });
      }
      return loading;
    },
    current: () => engine,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
