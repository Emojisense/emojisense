import { noteSearch } from "./activity.js";
import { assessConfidence } from "./confidence.js";
import { applyCulture, type Culture, resolveRegion } from "./culture.js";
import type { AliasEngine, AliasSearchOutput, CanonicalSearchOutput, SearchResult } from "./engine.js";
import { shouldUseSemantic as defaultShouldUseSemantic, fuse, RANK_DEPTH } from "./fusion.js";
import {
  AUTO_REGION,
  isAutoRegion,
  type SemanticLayer,
  type SemanticProvider,
  type SemanticResponse,
} from "./provider.js";

export type SessionStatus = "idle" | "alias" | "loading" | "fused" | "error";

export interface SessionState {
  query: string;
  /** What to show: the ranking, plus culture results after its top result when a culture file is set. */
  results: SearchResult[];
  /** The canonical alias output (no culture results). */
  alias: CanonicalSearchOutput;
  status: SessionStatus;
  /** Time spent in the alias engine for this query, ms. */
  aliasMs: number;
  /** Round-trip time of the last semantic request, when one finished. */
  semanticMs?: number;
  semanticCached?: boolean;
  /** Which layer gave the semantic results ("shard", "api", …). */
  layer?: SemanticLayer;
  error?: unknown;
  /**
   * No tier understood the query (`assessConfidence`): the dictionary does not cover it and the
   * semantic list is flat or low. While `loading`, the dictionary's verdict alone. Show the
   * results as guesses.
   */
  unsure: boolean;
  /** 0–1: how well the best tier understood the query. */
  confidence: number;
}

export interface SearchSessionOptions {
  engine: AliasEngine;
  /** Omit for alias-only (fully offline) search. Use chainProviders(shards, api) for layers. */
  semantic?: SemanticProvider;
  locale?: string;
  limit?: number;
  /** Delay before a semantic request, after the last keystroke. Default 200 ms. */
  debounceMs?: number;
  shouldUseSemantic?: (alias: AliasSearchOutput) => boolean;
  /**
   * Culture file for the culture layer. Default: the engine's (`engine.withCulture`). `false` turns
   * it off for reproducible ranking. It is applied last, after fusion, so the top result of the
   * canonical ranking stays first.
   */
  culture?: Culture | false;
  /**
   * ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". Default (or `"device"`):
   * the device's region, from its language or else its time zone ({@link resolveRegion}). `""`:
   * none, only entries for every region. `"auto"`: the region the API reports for the caller's
   * country (`region=auto`), learned from the first API answer that has one.
   */
  region?: string;
  /** The clock that culture windows are checked against (its local day). Default: `Date.now`. */
  now?: () => Date | number;
  onChange: (state: SessionState) => void;
}

export interface SearchSession {
  /** Call on every keystroke. Alias results are delivered synchronously. */
  update(query: string): void;
  dispose(): void;
}

/**
 * Framework-agnostic search controller: alias results on every keystroke, then semantic results
 * fused in: at once when a provider has them in memory (a loaded shard), else debounced and
 * cancellable. Stale responses are dropped.
 */
export function createSearchSession(options: SearchSessionOptions): SearchSession {
  const {
    engine,
    semantic,
    locale,
    limit = 24,
    debounceMs = 200,
    shouldUseSemantic = defaultShouldUseSemantic,
    region,
    now = Date.now,
    onChange,
  } = options;
  const culture = options.culture === false ? undefined : (options.culture ?? engine.culture);
  const auto = isAutoRegion(region);
  const fixedRegion = auto ? undefined : resolveRegion(region, culture);
  /** With `region: "auto"`, the region of the first API answer that reported one. */
  let learnedRegion: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;
  // The shard indexes load while the user starts typing, which also opens the connection.
  semantic?.prefetch?.("", locale ? { locale } : {});

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    inflight?.abort();
    timer = undefined;
    inflight = undefined;
  };

  return {
    update(query) {
      cancel();
      noteSearch();
      // Fusion sees the same candidates whatever the limit (RANK_DEPTH); the results are cut to it.
      const depth = Math.max(limit, RANK_DEPTH);
      const aliasStarted = performance.now();
      const alias = engine.search(query, { limit: depth, culture: false, ...(locale ? { locale } : {}) });
      const aliasMs = performance.now() - aliasStarted;
      const shown = alias.results.slice(0, limit);
      const present = (results: SearchResult[]): SearchResult[] =>
        culture
          ? applyCulture(results, culture, query, {
              engine,
              locale,
              region: auto ? learnedRegion : fixedRegion,
              now: now(),
              limit,
            })
          : results;
      const wantsSemantic = semantic !== undefined && shouldUseSemantic(alias);
      const aliasOnly = { ...assessConfidence(alias, undefined), alias, aliasMs };
      const request = {
        limit: depth,
        ...(locale ? { locale } : {}),
        ...(auto ? { region: AUTO_REGION } : {}),
      };
      const fused = (response: SemanticResponse, semanticMs: number): SessionState => {
        // The model that scored the results knows its calibration; older servers send none.
        const { calibration } = response;
        return {
          query,
          results: present(fuse(alias, response.results, limit, calibration)),
          alias,
          aliasMs,
          ...assessConfidence(alias, response.results, calibration),
          status: "fused",
          semanticMs,
          semanticCached: response.cached,
          ...(response.layer ? { layer: response.layer } : {}),
        };
      };

      // A loaded shard (or an answer this session already had) needs no debounce: no request.
      const peeked = wantsSemantic ? semantic.peek?.(query, request) : undefined;
      if (peeked) {
        onChange(fused(peeked, 0));
        return;
      }
      onChange({
        query,
        results: present(shown),
        ...aliasOnly,
        status: alias.tokens.length === 0 ? "idle" : wantsSemantic ? "loading" : "alias",
      });
      if (!wantsSemantic) return;
      // The query's shard loads during the debounce, so the next keystroke can peek at it.
      semantic.prefetch?.(query, locale ? { locale } : {});

      timer = setTimeout(async () => {
        const controller = new AbortController();
        inflight = controller;
        const started = performance.now();
        try {
          const response = await semantic.search(query, { ...request, signal: controller.signal });
          if (controller.signal.aborted) return;
          if (auto && typeof response?.region === "string") learnedRegion ??= response.region;
          if (!response) {
            // No layer had an answer (or the key is over its limit): alias results stand.
            onChange({ query, results: present(shown), ...aliasOnly, status: "alias" });
            return;
          }
          onChange(fused(response, performance.now() - started));
        } catch (error) {
          if (controller.signal.aborted) return;
          onChange({ query, results: present(shown), ...aliasOnly, status: "error", error });
        }
      }, debounceMs);
    },
    dispose: cancel,
  };
}
