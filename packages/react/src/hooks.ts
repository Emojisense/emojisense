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
}

export interface Emojisense {
  engine: AliasEngine | undefined;
  semantic: SemanticClient | undefined;
  packs: Pack[];
  locale: string;
  status: "loading" | "ready" | "error";
  error?: unknown;
}

/** Load the data packs once and build the alias engine (and the semantic client, if configured). */
export function useEmojisense(options: EmojisenseOptions): Emojisense {
  const { packBaseUrl, locale = "en", endpoint, publishableKey } = options;
  const [state, setState] = useState<{ packs: Pack[]; error?: unknown }>({ packs: [] });

  useEffect(() => {
    const controller = new AbortController();
    setState({ packs: [] });
    loadPacks({ baseUrl: packBaseUrl, locales: [locale], signal: controller.signal }).then(
      (packs) => setState({ packs }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ packs: [], error });
      },
    );
    return () => controller.abort();
  }, [packBaseUrl, locale]);

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
