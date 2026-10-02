import type { AliasEngine, AliasSearchOutput, SearchResult } from "./engine.js";
import { shouldUseSemantic as defaultShouldUseSemantic, fuse } from "./fusion.js";
import type { SemanticLayer, SemanticProvider } from "./provider.js";

export type SessionStatus = "idle" | "alias" | "loading" | "fused" | "error";

export interface SessionState {
  query: string;
  results: SearchResult[];
  alias: AliasSearchOutput;
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
    onChange,
  } = options;
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
      const alias = engine.search(query, { limit, ...(locale ? { locale } : {}) });
      const aliasMs = performance.now() - aliasStarted;
      const wantsSemantic = semantic !== undefined && shouldUseSemantic(alias);
      onChange({
        query,
        results: alias.results,
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
            onChange({ query, results: alias.results, alias, aliasMs, status: "alias" });
            return;
          }
          onChange({
            query,
            results: fuse(alias, response.results, limit),
            alias,
            aliasMs,
            status: "fused",
            semanticMs: performance.now() - started,
            semanticCached: response.cached,
            ...(response.layer ? { layer: response.layer } : {}),
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          onChange({ query, results: alias.results, alias, aliasMs, status: "error", error });
        }
      }, debounceMs);
    },
    dispose: cancel,
  };
}
