import {
  type AliasEngine,
  type AliasSearchOutput,
  type Culture,
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  type EmojiSet,
  loadCulture,
  loadCustomPack,
  loadPacks,
  type Pack,
  type RelevantEmoji,
  relevantNow,
  type SearchResult,
  type SemanticLayer,
  type SemanticProvider,
  type SessionState,
  type SessionStatus,
} from "emojisense";
import { useEffect, useMemo, useRef, useState } from "react";

export interface EmojisenseOptions {
  /** Pack version base URL, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  packBaseUrl: string;
  /** UI locale. "tr" loads the Turkish pack next to English. */
  locale?: string;
  /**
   * Precomputed results (layer 2), e.g. "https://api.emojisense.com/p/0.1.0". Free static files,
   * asked before the API.
   */
  shardsUrl?: string;
  /** Semantic API base URL (layer 3). Omit both this and `shardsUrl` for on-device search only. */
  endpoint?: string;
  publishableKey?: string;
  /** Load the extension packs (more aliases, typos) when the browser is idle. Default true. */
  extended?: boolean;
  /**
   * How pickers draw emoji. Default "native" (the system font). "twemoji", "noto" and "fluent"
   * draw images hosted at `${endpoint}/v1/sets/<set>/<hexcode>.svg`, so they need `endpoint`.
   */
  emojiSet?: EmojiSet;
  /**
   * Load the app's custom emoji (GET /v1/custom-pack) so they are searched on the device and
   * drawn as images. Needs `endpoint` and `publishableKey`. Default false.
   */
  customEmoji?: boolean;
  /** The app owner's id for one of their customers: adds that tenant's custom emoji. */
  tenant?: string;
  /**
   * Culture files, e.g. "https://api.emojisense.com/v1/culture/0.1.0". Editorial emoji for the
   * moment and the culture join the results after the top result (never above it). Omit it for
   * the canonical ranking. A failed load is ignored.
   */
  cultureUrl?: string;
  /** ISO 3166-1 alpha-2 region, e.g. "BR". Regional culture entries apply only with it. */
  region?: string;
}

export interface Emojisense {
  engine: AliasEngine | undefined;
  /** Shards, then the API, whichever are configured. */
  semantic: SemanticProvider | undefined;
  /** The locale packs (core, then ext). The custom pack is in `customPack`. */
  packs: Pack[];
  /** The app's custom emoji once loaded (`customEmoji: true`); part of `engine`. */
  customPack?: Pack;
  locale: string;
  status: "loading" | "ready" | "error";
  /** True once the idle-time extension packs are in the engine. */
  extended: boolean;
  /** How pickers draw emoji; see `EmojisenseOptions.emojiSet`. Undefined = "native". */
  emojiSet?: EmojiSet;
  /** The API base URL, for hosted emoji set images. */
  endpoint?: string;
  /** The loaded culture file (also attached to `engine`), once `cultureUrl` answered. */
  culture?: Culture;
  region?: string;
  error?: unknown;
}

/** Load the data packs once and build the alias engine (and the semantic layers, if configured). */
export function useEmojisense(options: EmojisenseOptions): Emojisense {
  const {
    packBaseUrl,
    locale = "en",
    shardsUrl,
    endpoint,
    publishableKey,
    extended = true,
    emojiSet = "native",
    customEmoji = false,
    tenant,
    cultureUrl,
    region,
  } = options;
  const [state, setState] = useState<{ packs: Pack[]; extended: boolean; error?: unknown }>({
    packs: [],
    extended: false,
  });
  const [customPack, setCustomPack] = useState<Pack>();

  useEffect(() => {
    setCustomPack(undefined);
    if (!customEmoji || !endpoint || !publishableKey) return;
    const controller = new AbortController();
    loadCustomPack({
      endpoint,
      key: publishableKey,
      ...(tenant ? { tenant } : {}),
      signal: controller.signal,
    }).then(
      (pack) => {
        if (!controller.signal.aborted) setCustomPack(pack);
      },
      () => {
        // Custom emoji are optional: the catalog keeps working without them.
      },
    );
    return () => controller.abort();
  }, [customEmoji, endpoint, publishableKey, tenant]);

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

  const [culture, setCulture] = useState<Culture | undefined>(undefined);
  useEffect(() => {
    setCulture(undefined);
    if (!cultureUrl) return;
    const controller = new AbortController();
    loadCulture({ baseUrl: cultureUrl, locale, signal: controller.signal }).then(
      (loaded) => {
        if (!controller.signal.aborted) setCulture(loaded);
      },
      () => {
        // The culture layer only adds results; search works the same without it.
      },
    );
    return () => controller.abort();
  }, [cultureUrl, locale]);

  const baseEngine = useMemo(
    () =>
      state.packs.length > 0
        ? createEngine(customPack ? [...state.packs, customPack] : state.packs)
        : undefined,
    [state.packs, customPack],
  );
  // withCulture shares the index, so a culture file arriving later does not rebuild it.
  const engine = useMemo(() => baseEngine?.withCulture(culture), [baseEngine, culture]);
  const packVersion = state.packs[0]?.packVersion;
  const semantic = useMemo(
    () => createLayeredSemantic({ shardsUrl, endpoint, key: publishableKey, packVersion }),
    [shardsUrl, endpoint, publishableKey, packVersion],
  );

  return {
    engine,
    semantic,
    packs: state.packs,
    ...(customPack ? { customPack } : {}),
    locale,
    status: state.error ? "error" : engine ? "ready" : "loading",
    extended: state.extended,
    emojiSet,
    ...(endpoint ? { endpoint } : {}),
    ...(culture ? { culture } : {}),
    ...(region ? { region } : {}),
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
  /**
   * Which layer produced `results`: "device" when the on-device dictionary answered alone,
   * "shard" or "api" once semantic results are fused in, `undefined` while idle or loading.
   * Count it when `status` settles to drive per-layer counters.
   */
  layer: SemanticLayer | undefined;
}

export interface UseEmojiSearchOptions {
  limit?: number;
  debounceMs?: number;
  /** `false` = canonical ranking only, even when a culture file is loaded (reproducible). */
  culture?: boolean;
}

const IDLE: EmojiSearchState = {
  results: [],
  status: "idle",
  alias: undefined,
  aliasMs: undefined,
  semanticMs: undefined,
  semanticCached: undefined,
  layer: undefined,
};

/**
 * Search as the user types. Alias results update synchronously on every keystroke; semantic
 * results (when an endpoint is configured) arrive debounced and are fused in without reordering
 * confident alias hits.
 */
export function useEmojiSearch(
  query: string,
  emojisense: Pick<Emojisense, "engine" | "semantic" | "locale" | "region">,
  options: UseEmojiSearchOptions = {},
): EmojiSearchState {
  const { engine, semantic, locale, region } = emojisense;
  const { limit = 24, debounceMs = 200, culture = true } = options;
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
      ...(culture ? {} : { culture: false as const }),
      ...(region ? { region } : {}),
      onChange: (s) =>
        setState({
          results: s.results,
          status: s.status,
          alias: s.alias,
          aliasMs: s.aliasMs,
          semanticMs: s.semanticMs,
          semanticCached: s.semanticCached,
          layer: layerOf(s),
        }),
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = undefined;
    };
  }, [engine, semantic, locale, region, limit, debounceMs, culture]);

  useEffect(() => {
    if (!engine) return;
    sessionRef.current?.update(query);
  }, [query, engine]);

  return query.trim() === "" ? IDLE : state;
}

export interface UseRelevantNowOptions {
  /** Default 8. */
  limit?: number;
  /** The day to show; default today. */
  now?: Date | number;
}

/**
 * Emoji for an optional "relevant now" shelf: featured seasonal and event entries of the culture
 * file that are active today. Empty without `cultureUrl`.
 */
export function useRelevantNow(
  emojisense: Pick<Emojisense, "culture" | "region" | "engine">,
  options: UseRelevantNowOptions = {},
): RelevantEmoji[] {
  const { culture, region, engine } = emojisense;
  const { limit = 8, now } = options;
  return useMemo(() => {
    if (!culture) return [];
    const shelf = relevantNow(culture, { limit, ...(region ? { region } : {}), ...(now ? { now } : {}) });
    // Only emoji the loaded packs know, drawn with the packs' glyph.
    return engine
      ? shelf.flatMap((item) => {
          const entry = engine.get(item.hexcode);
          return entry ? [{ ...item, emoji: entry.emoji }] : [];
        })
      : shelf;
  }, [culture, region, engine, limit, now]);
}

function layerOf(state: SessionState): SemanticLayer | undefined {
  switch (state.status) {
    case "fused":
      return state.layer;
    // No semantic layer answered, or it failed: the results on screen are the on-device ones.
    case "alias":
    case "error":
      return "device";
    default:
      return undefined;
  }
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
