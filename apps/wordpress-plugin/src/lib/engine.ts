import {
  type AliasEngine,
  type Culture,
  createEngine,
  createLayeredSemantic,
  loadCulture,
  loadPacks,
  type Pack,
  type SemanticProvider,
} from "emojisense";
import type { ClientConfig } from "./config.js";

export interface EngineLoaderOptions {
  config: ClientConfig;
  fetch?: typeof fetch;
  /** Runs a task when the browser is idle. Tests pass a synchronous one. */
  whenIdle?: (task: () => void) => void;
}

/**
 * Loads the packs of this site once, on first use: the core packs first, then the extension
 * packs (more aliases and typos) when the browser is idle. Listeners hear about each engine.
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
  const { config, whenIdle = defaultWhenIdle } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<(engine: AliasEngine) => void>();
  let engine: AliasEngine | undefined;
  let loading: Promise<AliasEngine> | undefined;

  const publish = (next: AliasEngine) => {
    engine = next;
    for (const listener of listeners) listener(next);
  };

  const culture = (): Promise<Culture | undefined> =>
    config.cultureUrl
      ? loadCulture({ baseUrl: config.cultureUrl, locale: config.locale, fetch: doFetch }).catch(
          () => undefined,
        )
      : Promise.resolve(undefined);

  const start = async (): Promise<AliasEngine> => {
    const locales = [config.locale];
    const [core, cultureFile] = await Promise.all([
      loadPacks({ baseUrl: config.packUrl, locales, fetch: doFetch }),
      culture(),
    ]);
    const options = cultureFile ? { culture: cultureFile } : {};
    const first = createEngine(core, options);
    publish(first);
    whenIdle(() => {
      loadPacks({ baseUrl: config.packUrl, locales, fetch: doFetch, part: "ext" }).then(
        (ext: Pack[]) => publish(createEngine([...core, ...ext], options)),
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

/**
 * The API's shards, then the API, as a semantic provider, only when search by meaning is on. The
 * API host serves the shards (/p/<packVersion>): free files, asked first.
 */
export function semanticProvider(
  config: ClientConfig,
  packVersion: string,
  fetchImpl?: typeof fetch,
): SemanticProvider | undefined {
  if (!config.endpoint) return undefined;
  return createLayeredSemantic({
    shardsUrl: `${config.endpoint.replace(/\/+$/, "")}/p/${packVersion}`,
    endpoint: config.endpoint,
    ...(config.key ? { key: config.key } : {}),
    packVersion,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}
