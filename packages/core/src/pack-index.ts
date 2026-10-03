import { msSinceSearch } from "./activity.js";
import { type AliasEngine, createEngine } from "./engine.js";
import { loadPacks } from "./loader.js";
import type { Pack } from "./pack.js";

/** The locale packs and their index, before culture and extra packs are added. */
export interface PackIndexState {
  readonly engine: AliasEngine;
  readonly packs: readonly Pack[];
}

export interface PackIndex {
  /** Loads the core packs once. A failed load may be retried. */
  load(): Promise<PackIndexState>;
  current(): PackIndexState | undefined;
  /** Hears each new state: the core packs, then core + extension. */
  subscribe(listener: (state: PackIndexState) => void): () => void;
}

export interface PackIndexOptions {
  packUrl: string;
  /** English always loads too, and alone when the locale has no pack. */
  locale: string;
  /** Load the extension packs (more aliases and typos) after the core packs. */
  extended: boolean;
  fetch?: typeof fetch | undefined;
  /** Starts the extension download. */
  whenIdle: (task: () => void) => void;
  /** Starts the extension index build. */
  whenQuiet: (task: () => void) => void;
}

/**
 * The typing pause that the extension index waits for. Its build blocks the main thread (about
 * 0.1 s on a laptop, 0.5 s on a phone), so it must not land between two keystrokes.
 */
export const QUIET_MS = 2000;

/** Runs a task after `QUIET_MS` without a search, in idle time when the browser has it. */
export function whenQuiet(task: () => void): void {
  const wait = QUIET_MS - msSinceSearch();
  if (wait > 0) {
    setTimeout(() => whenQuiet(task), wait);
    return;
  }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (!idle) {
    task();
    return;
  }
  idle(() => (msSinceSearch() < QUIET_MS ? whenQuiet(task) : task()), { timeout: QUIET_MS });
}

const indexes = new WeakMap<typeof fetch, Map<string, PackIndex>>();

/**
 * One download and one index per pack URL, locale and fetch function, shared by every loader on
 * the page: a second picker, or a picker that opens again, is ready at once.
 */
export function sharedPackIndex(options: PackIndexOptions): PackIndex {
  const fetchKey = options.fetch ?? globalThis.fetch;
  let byKey = indexes.get(fetchKey);
  if (!byKey) {
    byKey = new Map();
    indexes.set(fetchKey, byKey);
  }
  const key = [options.packUrl.replace(/\/+$/, ""), options.locale, options.extended].join("\n");
  let index = byKey.get(key);
  if (!index) {
    index = createPackIndex(options);
    byKey.set(key, index);
  }
  return index;
}

function createPackIndex(options: PackIndexOptions): PackIndex {
  const { packUrl, locale, extended } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<(state: PackIndexState) => void>();
  let state: PackIndexState | undefined;
  let loading: Promise<PackIndexState> | undefined;

  const publish = (packs: Pack[]): PackIndexState => {
    state = { engine: createEngine(packs), packs };
    for (const listener of listeners) listener(state);
    return state;
  };

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

  const start = async (): Promise<PackIndexState> => {
    const { packs: core, locales } = await corePacks();
    const first = publish(core);
    if (extended) {
      options.whenIdle(() => {
        loadPacks({ baseUrl: packUrl, locales, fetch: doFetch, part: "ext" }).then(
          (ext) => options.whenQuiet(() => publish([...core, ...ext])),
          () => {
            // Optional upgrade: the core packs keep working.
          },
        );
      });
    }
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
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
