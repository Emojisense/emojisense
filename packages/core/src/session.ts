import { applyCulture, type Culture } from "./culture.js";
import type { AliasEngine, AliasSearchOutput, CanonicalSearchOutput, SearchResult } from "./engine.js";
import { shouldUseSemantic as defaultShouldUseSemantic, fuse } from "./fusion.js";
import type { SemanticLayer, SemanticProvider } from "./provider.js";

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
  /** ISO 3166-1 alpha-2 region for regional culture entries, e.g. "BR". */
  region?: string;
  onChange: (state: SessionState) => void;
}

export interface SearchSession {
  /** Call on every keystroke. Alias results are delivered synchronously. */
  update(query: string): void;
  dispose(): void;
}

/**
 * Framework-agnostic search controller: alias results on every keystroke, then (debounced,
 * cancellable) semantic results fused in. Stale responses are dropped.
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
    onChange,
  } = options;
  const culture = options.culture === false ? undefined : (options.culture ?? engine.culture);
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
        culture ? applyCulture(results, culture, query, { engine, locale, region, limit }) : results;
      const wantsSemantic = semantic !== undefined && shouldUseSemantic(alias);
      onChange({
        query,
        results: present(alias.results),
        alias,
        aliasMs,
        status: alias.tokens.length === 0 ? "idle" : wantsSemantic ? "loading" : "alias",
      });
      if (!wantsSemantic) return;

      timer = setTimeout(async () => {
        const controller = new AbortController();
        inflight = controller;
        const started = performance.now();
        try {
          const response = await semantic.search(query, {
            limit,
            signal: controller.signal,
            ...(locale ? { locale } : {}),
          });
          if (controller.signal.aborted) return;
          if (!response) {
            // No layer had an answer (or the key is over its limit): alias results stand.
            onChange({ query, results: present(alias.results), alias, aliasMs, status: "alias" });
            return;
          }
          onChange({
            query,
            results: present(fuse(alias, response.results, limit)),
            alias,
            aliasMs,
            status: "fused",
            semanticMs: performance.now() - started,
            semanticCached: response.cached,
            ...(response.layer ? { layer: response.layer } : {}),
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          onChange({ query, results: present(alias.results), alias, aliasMs, status: "error", error });
        }
      }, debounceMs);
    },
    dispose: cancel,
  };
}
