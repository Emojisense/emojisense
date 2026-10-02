import {
  type AliasEngine,
  type AliasSearchOutput,
  createEngine,
  createSearchSession,
  createSemanticClient,
  loadPacks,
  type Pack,
  type SearchResult,
  type SemanticClient,
  type SessionStatus,
} from "emojisense";
import { useEffect, useMemo, useRef, useState } from "react";

export interface EmojisenseOptions {
  /** Pack version base URL, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  packBaseUrl: string;
  /** UI locale. "tr" loads the Turkish pack next to English. */
  locale?: string;
  /** Semantic API base URL. Omit for offline alias search only. */
  endpoint?: string;
  publishableKey?: string;
  /** Load the extension packs (more aliases, typos) when the browser is idle. Default true. */
  extended?: boolean;
}

export interface Emojisense {
  engine: AliasEngine | undefined;
  semantic: SemanticClient | undefined;
  packs: Pack[];
  locale: string;
  status: "loading" | "ready" | "error";
  /** True once the idle-time extension packs are in the engine. */
  extended: boolean;
  error?: unknown;
}

/** Load the data packs once and build the alias engine (and the semantic client, if configured). */
export function useEmojisense(options: EmojisenseOptions): Emojisense {
  const { packBaseUrl, locale = "en", endpoint, publishableKey, extended = true } = options;
  const [state, setState] = useState<{ packs: Pack[]; extended: boolean; error?: unknown }>({
    packs: [],
    extended: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let idle: number | undefined;
    setState({ packs: [], extended: false });
    loadPacks({ baseUrl: packBaseUrl, locales: [locale], signal }).then(
      (core) => {
        setState({ packs: core, extended: false });
        if (!extended) return;
        // Core packs answer right away; the extension (≈ 2× the size) waits for an idle moment.
        idle = whenIdle(() => {
          loadPacks({ baseUrl: packBaseUrl, locales: [locale], signal, part: "ext" }).then(
            (ext) => setState({ packs: [...core, ...ext], extended: true }),
            () => {
              // The core packs keep working; the extension is an optional upgrade.
            },
          );
        });
      },
      (error: unknown) => {
        if (!signal.aborted) setState({ packs: [], extended: false, error });
      },
    );
    return () => {
      controller.abort();
      if (idle !== undefined) cancelIdle(idle);
    };
  }, [packBaseUrl, locale, extended]);

  const engine = useMemo(
    () => (state.packs.length > 0 ? createEngine(state.packs) : undefined),
    [state.packs],
  );
  const packVersion = state.packs[0]?.packVersion;
  const semantic = useMemo(
    () =>
      endpoint
        ? createSemanticClient({
            endpoint,
            ...(publishableKey ? { key: publishableKey } : {}),
            ...(packVersion ? { packVersion } : {}),
          })
        : undefined,
    [endpoint, publishableKey, packVersion],
  );

  return {
    engine,
    semantic,
    packs: state.packs,
    locale,
    status: state.error ? "error" : engine ? "ready" : "loading",
    extended: state.extended,
    ...(state.error ? { error: state.error } : {}),
  };
}

export interface EmojiSearchState {
  results: SearchResult[];
  status: SessionStatus;
  alias: AliasSearchOutput | undefined;
  /** Alias engine time for the current query, ms. */
  aliasMs: number | undefined;
  /** Round trip of the last semantic request, ms. */
  semanticMs: number | undefined;
  semanticCached: boolean | undefined;
}

export interface UseEmojiSearchOptions {
  limit?: number;
  debounceMs?: number;
}

const IDLE: EmojiSearchState = {
  results: [],
  status: "idle",
  alias: undefined,
  aliasMs: undefined,
  semanticMs: undefined,
  semanticCached: undefined,
};

/**
 * Search as the user types. Alias results update synchronously on every keystroke; semantic
 * results (when an endpoint is configured) arrive debounced and are fused in without reordering
 * confident alias hits.
 */
export function useEmojiSearch(
  query: string,
  emojisense: Pick<Emojisense, "engine" | "semantic" | "locale">,
  options: UseEmojiSearchOptions = {},
): EmojiSearchState {
  const { engine, semantic, locale } = emojisense;
  const { limit = 24, debounceMs = 200 } = options;
  const [state, setState] = useState<EmojiSearchState>(IDLE);
  const sessionRef = useRef<ReturnType<typeof createSearchSession> | undefined>(undefined);

  useEffect(() => {
    if (!engine) return;
    const session = createSearchSession({
      engine,
      ...(semantic ? { semantic } : {}),
      locale,
      limit,
      debounceMs,
      onChange: (s) =>
        setState({
          results: s.results,
          status: s.status,
          alias: s.alias,
          aliasMs: s.aliasMs,
          semanticMs: s.semanticMs,
          semanticCached: s.semanticCached,
        }),
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = undefined;
    };
  }, [engine, semantic, locale, limit, debounceMs]);

  useEffect(() => {
    if (!engine) return;
    sessionRef.current?.update(query);
  }, [query, engine]);

  return query.trim() === "" ? IDLE : state;
}

const IDLE_TIMEOUT_MS = 2000;

function whenIdle(callback: () => void): number {
  return typeof requestIdleCallback === "function"
    ? requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS })
    : (setTimeout(callback, 1) as unknown as number);
}

function cancelIdle(handle: number) {
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
}
