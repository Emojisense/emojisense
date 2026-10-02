import type { SemanticClient } from "./client.js";
import type { AliasEngine, AliasSearchOutput, SearchResult } from "./engine.js";
import { shouldUseSemantic as defaultShouldUseSemantic, fuse } from "./fusion.js";

export type SessionStatus = "idle" | "alias" | "loading" | "fused" | "error";

export interface SessionState {
  query: string;
  results: SearchResult[];
  alias: AliasSearchOutput;
  status: SessionStatus;
  /** Round-trip time of the last semantic request, when one finished. */
  semanticMs?: number;
  semanticCached?: boolean;
  error?: unknown;
}

export interface SearchSessionOptions {
  engine: AliasEngine;
  /** Omit for alias-only (fully offline) search. */
  semantic?: SemanticClient;
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
      const alias = engine.search(query, { limit, ...(locale ? { locale } : {}) });
      const wantsSemantic = semantic !== undefined && shouldUseSemantic(alias);
      onChange({
        query,
        results: alias.results,
        alias,
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
          onChange({
            query,
            results: fuse(alias, response.results, limit),
            alias,
            status: "fused",
            semanticMs: performance.now() - started,
            semanticCached: response.cached,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          onChange({ query, results: alias.results, alias, status: "error", error });
        }
      }, debounceMs);
    },
    dispose: cancel,
  };
}
