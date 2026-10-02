import { assessConfidence, mergeConcept } from "./confidence.js";
import { applyCulture, type Culture } from "./culture.js";
import type { AliasEngine, AliasSearchOutput, CanonicalSearchOutput, SearchResult } from "./engine.js";
import { shouldUseSemantic as defaultShouldUseSemantic, fuse } from "./fusion.js";
import {
  AUTO_REGION,
  type ConceptInfo,
  isAutoRegion,
  type SemanticLayer,
  type SemanticProvider,
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
   * results as guesses unless `concept.status` is "ok".
   */
  unsure: boolean;
  /** 0–1: how well the best tier understood the query. */
  confidence: number;
  /**
   * The server's concept tier for an unsure query (API layer only): with status "ok" the results
   * lead with its emoji (`source: "concept"`) and `terms` say how it read the query ("rapper",
   * "hip hop"). "pending": the session asks again shortly.
   */
  concept?: ConceptInfo;
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
   * ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". `"auto"`: the region the
   * API reports for the caller's country (`region=auto`), learned from the first API answer
   * that has one; until then only entries for every region apply.
   */
  region?: string;
  /** Wait before asking again when the server's concept answer is pending. Default 1500 ms. */
  conceptRetryMs?: number;
  onChange: (state: SessionState) => void;
}

export interface SearchSession {
  /** Call on every keystroke. Alias results are delivered synchronously. */
  update(query: string): void;
  dispose(): void;
}

/** Times a pending concept answer is asked for again (the server keeps working on it). */
const CONCEPT_RETRIES = 2;

/**
 * Framework-agnostic search controller: alias results on every keystroke, then (debounced,
 * cancellable) semantic results fused in, and the server's concept results for unsure queries.
 * Stale responses are dropped.
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
    conceptRetryMs = 1500,
    onChange,
  } = options;
  const culture = options.culture === false ? undefined : (options.culture ?? engine.culture);
  const auto = isAutoRegion(region);
  /** With `region: "auto"`, the region of the first API answer that reported one. */
  let learnedRegion: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    inflight?.abort();
    timer = undefined;
    inflight = undefined;
  };

  return {
    update(query) {
      cancel();
      const aliasStarted = performance.now();
      const alias = engine.search(query, { limit, culture: false, ...(locale ? { locale } : {}) });
      const aliasMs = performance.now() - aliasStarted;
      const present = (results: SearchResult[]): SearchResult[] =>
        culture
          ? applyCulture(results, culture, query, {
              engine,
              locale,
              region: auto ? learnedRegion : region,
              limit,
            })
          : results;
      const wantsSemantic = semantic !== undefined && shouldUseSemantic(alias);
      const aliasOnly = { ...assessConfidence(alias, undefined), alias, aliasMs };
      onChange({
        query,
        results: present(alias.results),
        ...aliasOnly,
        status: alias.tokens.length === 0 ? "idle" : wantsSemantic ? "loading" : "alias",
      });
      if (!wantsSemantic) return;

      const ask = async (retriesLeft: number) => {
        const controller = new AbortController();
        inflight = controller;
        const started = performance.now();
        try {
          const response = await semantic.search(query, {
            limit,
            signal: controller.signal,
            ...(locale ? { locale } : {}),
            ...(auto ? { region: AUTO_REGION } : {}),
          });
          if (controller.signal.aborted) return;
          if (auto && typeof response?.region === "string") learnedRegion ??= response.region;
          if (!response) {
            // No layer had an answer (or the key is over its limit): alias results stand.
            onChange({ query, results: present(alias.results), ...aliasOnly, status: "alias" });
            return;
          }
          const semanticList = response.results.filter((r) => r.source !== "concept");
          const conceptList = response.results.filter((r) => r.source === "concept");
          const concept = response.concept ?? undefined;
          onChange({
            query,
            results: present(
              mergeConcept(
                fuse(alias, semanticList, limit, undefined, { popularity: engine.popularity }),
                conceptList,
                alias,
                limit,
              ),
            ),
            alias,
            aliasMs,
            ...assessConfidence(alias, semanticList),
            ...(concept ? { concept } : {}),
            status: "fused",
            semanticMs: performance.now() - started,
            semanticCached: response.cached,
            ...(response.layer ? { layer: response.layer } : {}),
          });
          if (concept?.status === "pending" && retriesLeft > 0) {
            timer = setTimeout(() => ask(retriesLeft - 1), conceptRetryMs);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          onChange({ query, results: present(alias.results), ...aliasOnly, status: "error", error });
        }
      };
      timer = setTimeout(() => ask(CONCEPT_RETRIES), debounceMs);
    },
    dispose: cancel,
  };
}
