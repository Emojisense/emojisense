import type { SearchResult } from "./engine.js";

/** Where a semantic answer came from (docs/ARCHITECTURE.md, layers). */
export type SemanticLayer = "device" | "shard" | "api";

export interface SemanticResponse {
  results: SearchResult[];
  packVersion: string;
  model?: string;
  cached: boolean;
  /** Server: Workers AI unavailable, results are alias-only. */
  degraded?: boolean;
  /** Server: the key is over its monthly limit; no semantic results until the next period. */
  overLimit?: boolean;
  /**
   * Server, `/v1/search?culture=1` only (the SDK applies culture on the device instead): the
   * culture file applied (its first day), the UTC day its windows were checked against (servers
   * since 2026-10-02) and the region, or null when none was applied.
   */
  culture?: { from: string; day?: string; region: string | null } | null;
  /** Set by the provider that answered. */
  layer?: SemanticLayer;
}

export interface SemanticSearchOptions {
  locale?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * A source of semantic results: precomputed shards, the HTTP API, or (later) an on-device
 * model. `undefined` means "no answer here" — the next provider is tried, and with none left the
 * client simply keeps its alias results.
 */
export interface SemanticProvider {
  search(query: string, options?: SemanticSearchOptions): Promise<SemanticResponse | undefined>;
}

/** Try providers in order (cheapest first, e.g. shards then API); the first answer wins. */
export function chainProviders(...providers: SemanticProvider[]): SemanticProvider {
  return {
    async search(query, options) {
      for (const provider of providers) {
        if (options?.signal?.aborted) return undefined;
        const response = await provider.search(query, options);
        if (response) return response;
      }
      return undefined;
    },
  };
}
