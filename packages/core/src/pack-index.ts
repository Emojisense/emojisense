import { msSinceSearch } from "./activity.js";
import { type AliasEngine, createEngine } from "./engine.js";
import { loadPack, packOrder } from "./loader.js";
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
  /**
   * The user's languages ("tr", "en"). English always loads too; a locale without a pack is left
   * out, so a site language Emojisense does not cover still gets English.
   */
  locales: readonly string[];
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
 * One download and one index per pack URL, set of locales and fetch function, shared by every
 * loader on the page: a second picker, or a picker that opens again, is ready at once.
 */
export function sharedPackIndex(options: PackIndexOptions): PackIndex {
  const fetchKey = options.fetch ?? globalThis.fetch;
  let byKey = indexes.get(fetchKey);
  if (!byKey) {
    byKey = new Map();
    indexes.set(fetchKey, byKey);
  }
  const locales = packOrder(options.locales).sort().join(",");
  const key = [options.packUrl.replace(/\/+$/, ""), locales, options.extended].join("\n");
  let index = byKey.get(key);
  if (!index) {
    index = createPackIndex(options);
    byKey.set(key, index);
  }
  return index;
}

function createPackIndex(options: PackIndexOptions): PackIndex {
  const { packUrl, extended } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<(state: PackIndexState) => void>();
  let state: PackIndexState | undefined;
  let loading: Promise<PackIndexState> | undefined;

  const publish = (packs: Pack[]): PackIndexState => {
    state = { engine: createEngine(packs), packs };
    for (const listener of listeners) listener(state);
    return state;
  };

  /**
   * The packs of `locales` that loaded, English first. English must load; a locale without a
   * pack (a site language Emojisense does not cover) is left out.
   */
  const packsOf = async (locales: readonly string[], part: "core" | "ext"): Promise<Pack[]> => {
    const settled = await Promise.allSettled(
      locales.map((locale) => loadPack({ baseUrl: packUrl, locale, part, fetch: doFetch })),
    );
    if (part === "core" && settled[0]?.status === "rejected") throw settled[0].reason;
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  };

  const start = async (): Promise<PackIndexState> => {
    const core = await packsOf(packOrder(options.locales), "core");
    const first = publish(core);
    if (extended) {
      options.whenIdle(() => {
        packsOf(
          core.map((pack) => pack.locale),
          "ext",
        ).then(
          (ext) => {
            // Optional upgrade: without extension packs the core packs keep working.
            if (ext.length > 0) options.whenQuiet(() => publish([...core, ...ext]));
          },
          () => {},
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
