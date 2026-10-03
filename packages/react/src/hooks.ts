import {
  type AliasEngine,
  type AliasSearchOutput,
  type Culture,
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  deviceRegion,
  type EmojiSet,
  isAutoRegion,
  loadCustomPack,
  localDay,
  type Pack,
  type RelevantEmoji,
  relevantNow,
  type SearchResult,
  type SemanticLayer,
  type SemanticProvider,
  type SessionState,
  type SessionStatus,
} from "emojisense";
import { createEngineLoader, type EngineLoader } from "emojisense/autocomplete";
import { createStatsReporter, type StatsReporter } from "emojisense/stats";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export interface EmojisenseOptions {
  /** Pack version base URL, e.g. "https://api.emojisense.com/v1/pack/0.1.0". */
  packBaseUrl: string;
  /** UI locale. "tr" loads the Turkish pack next to English. */
  locale?: string;
  /**
   * Precomputed results (layer 2), e.g. "https://cdn.emojisense.com/p/0.1.0". Free static files,
   * asked before the API.
   */
  shardsUrl?: string;
  /** Semantic API base URL (layer 3). Omit both this and `shardsUrl` for on-device search only. */
  endpoint?: string;
  publishableKey?: string;
  /**
   * Load the extension packs (more aliases, typos) after the core packs. Their index is built in
   * a pause in typing. Default true.
   */
  extended?: boolean;
  /**
   * How pickers draw emoji. Default "native" (the system font). "twemoji", "noto" and "fluent"
   * draw images hosted at `${endpoint}/v1/sets/<set>/<hexcode>.svg`, so they need `endpoint` and
   * a `publishableKey` whose plan includes hosted sets.
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
   * moment and the culture join the results after the top result (never above it). Default: the
   * culture directory next to `packBaseUrl`. `false`: the canonical ranking only. A failed load
   * is ignored, and the culture file never delays the first engine.
   */
  cultureUrl?: string | false;
  /**
   * ISO 3166-1 alpha-2 region, e.g. "BR". Regional culture entries apply only with it. Default:
   * the region of the browser's language (`navigator.language` "pt-BR" → "BR"), read on the
   * device and never sent. `""` = no region. `"auto"`: the region the API reports for the
   * request's country (`region=auto`, needs `endpoint`), learned from the first API answer of a
   * search; the relevant-now shelf then shows entries for every region only.
   */
  region?: string;
  /**
   * Where to report how searches end and which emoji are picked (`POST /v1/events`), e.g.
   * "https://stats.emojisense.com". Off when omitted. Counts and picks only (emojisense/stats).
   */
  statsUrl?: string;
  /** Share of sessions that report, 0–1. Default 0.1. */
  statsSample?: number;
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
  /** True once the extension packs are in the engine. */
  extended: boolean;
  /** How pickers draw emoji; see `EmojisenseOptions.emojiSet`. Undefined = "native". */
  emojiSet?: EmojiSet;
  /** The API base URL, for hosted emoji set images. */
  endpoint?: string;
  /** The publishable key, which hosted emoji set images send. */
  publishableKey?: string;
  /** The loaded culture file (also attached to `engine`), once `cultureUrl` answered. */
  culture?: Culture;
  /** The region for culture entries: the `region` option, else the browser's region. */
  region?: string;
  /** With `statsUrl`: report picks with `stats.pick(query, id)`; `useEmojiSearch` counts searches. */
  stats?: StatsReporter;
  error?: unknown;
}

type LoaderOptions = Pick<EmojisenseOptions, "packBaseUrl" | "locale" | "extended" | "cultureUrl">;

const NO_PACKS: readonly Pack[] = [];

/**
 * The pack loader for these options. Every hook, picker and `preloadEmojisense` call with the same
 * `packBaseUrl`, `locale` and `extended` shares one download and one index, so a picker that mounts
 * again is ready on its first render.
 */
function packLoader({ packBaseUrl, locale = "en", extended = true, cultureUrl }: LoaderOptions): EngineLoader {
  return createEngineLoader({ packUrl: packBaseUrl, locale, extended, cultureUrl });
}

/**
 * Start loading the packs before a picker mounts, e.g. when the pointer moves onto or focus enters
 * the button that opens it. `useEmojisense` with the same options then uses this download.
 */
export function preloadEmojisense(options: LoaderOptions): void {
  packLoader(options).preload();
}

/**
 * Load the data packs and build the alias engine (and the semantic layers, if configured). The
 * load starts when the component mounts: mount the hook with the picker to load on open.
 */
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
    region = deviceRegion(),
    statsUrl,
    statsSample,
  } = options;
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

  const loader = useMemo(
    () => packLoader({ packBaseUrl, locale, extended, cultureUrl }),
    [packBaseUrl, locale, extended, cultureUrl],
  );
  // The loader's engine carries the culture file once it is there (`engine.culture`).
  const localeEngine = useSyncExternalStore(loader.subscribe, loader.current, loader.current);
  const loadedPacks = localeEngine ? loader.packs() : NO_PACKS;
  const packs = useMemo(() => [...loadedPacks], [loadedPacks]);
  const [failure, setFailure] = useState<{ loader: EngineLoader; error: unknown }>();
  useEffect(() => {
    let active = true;
    loader.load().catch((error: unknown) => {
      if (active) setFailure({ loader, error });
    });
    return () => {
      active = false;
    };
  }, [loader]);
  const error = failure?.loader === loader && !localeEngine ? failure.error : undefined;

  const culture = localeEngine?.culture;
  // The custom pack needs its own index; without one, the shared index is used as it is.
  const customEngine = useMemo(
    () => (customPack && packs.length > 0 ? createEngine([...packs, customPack]) : undefined),
    [packs, customPack],
  );
  // withCulture shares the index, so a culture file arriving later does not rebuild it.
  const engine = useMemo(
    () => (customEngine ? customEngine.withCulture(culture) : localeEngine),
    [customEngine, culture, localeEngine],
  );
  const packVersion = packs[0]?.packVersion;
  const semantic = useMemo(
    () => createLayeredSemantic({ shardsUrl, endpoint, key: publishableKey, packVersion }),
    [shardsUrl, endpoint, publishableKey, packVersion],
  );

  const stats = useMemo(
    () =>
      statsUrl
        ? createStatsReporter({
            endpoint: statsUrl,
            ...(publishableKey ? { key: publishableKey } : {}),
            ...(statsSample === undefined ? {} : { sampleRate: statsSample }),
            locale,
          })
        : undefined,
    [statsUrl, publishableKey, statsSample, locale],
  );
  useEffect(() => () => stats?.dispose(), [stats]);

  return {
    engine,
    semantic,
    packs,
    ...(customPack ? { customPack } : {}),
    locale,
    status: error !== undefined ? "error" : engine ? "ready" : "loading",
    extended: packs.some((pack) => pack.part === "ext"),
    emojiSet,
    ...(endpoint ? { endpoint } : {}),
    ...(publishableKey ? { publishableKey } : {}),
    ...(culture ? { culture } : {}),
    ...(region ? { region } : {}),
    ...(stats ? { stats } : {}),
    ...(error !== undefined ? { error } : {}),
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
const LOADING: EmojiSearchState = { ...IDLE, status: "loading" };

/**
 * Search as the user types. Alias results update synchronously on every keystroke; semantic
 * results (when an endpoint is configured) arrive debounced and are fused in without reordering
 * confident alias hits.
 */
export function useEmojiSearch(
  query: string,
  emojisense: Pick<Emojisense, "engine" | "semantic" | "locale" | "region" | "stats">,
  options: UseEmojiSearchOptions = {},
): EmojiSearchState {
  const { engine, semantic, locale, region, stats } = emojisense;
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
      // The region is resolved here; "" tells the session not to use the device's region.
      region: region ?? "",
      onChange: (s) => {
        stats?.observe(s);
        setState({
          results: s.results,
          status: s.status,
          alias: s.alias,
          aliasMs: s.aliasMs,
          semanticMs: s.semanticMs,
          semanticCached: s.semanticCached,
          layer: layerOf(s),
        });
      },
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = undefined;
    };
  }, [engine, semantic, locale, region, stats, limit, debounceMs, culture]);

  useEffect(() => {
    if (!engine) return;
    sessionRef.current?.update(query);
  }, [query, engine]);

  if (query.trim() === "") return IDLE;
  // A query typed before the packs arrived runs as soon as they do.
  return engine ? state : LOADING;
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
  const { culture, engine } = emojisense;
  // With "auto", only a search learns the region; the shelf shows entries for every region.
  const region = isAutoRegion(emojisense.region) ? undefined : emojisense.region;
  const { limit = 8, now } = options;
  // The device's calendar day: a render after midnight shows the new day's shelf.
  const day = localDay(now);
  return useMemo(() => {
    if (!culture) return [];
    const shelf = relevantNow(culture, { limit, day, ...(region ? { region } : {}) });
    // Only emoji the loaded packs know, drawn with the packs' glyph.
    return engine
      ? shelf.flatMap((item) => {
          const entry = engine.get(item.hexcode);
          return entry ? [{ ...item, emoji: entry.emoji }] : [];
        })
      : shelf;
  }, [culture, region, engine, limit, day]);
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
