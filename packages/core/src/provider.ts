import type { SearchResult } from "./engine.js";
import type { SemanticCalibration } from "./fusion.js";

/** Where a semantic answer came from (docs/ARCHITECTURE.md, layers). */
export type SemanticLayer = "device" | "shard" | "api";

export interface SemanticResponse {
  results: SearchResult[];
  packVersion: string;
  model?: string;
  /**
   * Server: the calibration of the model that scored `results`. The client fuses and judges with
   * it, so a model change on the server needs no client update. Absent: the client's default.
   */
  calibration?: SemanticCalibration;
  /** Answered from a cache: the server's shared one, or the client's own memory. */
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
  /**
   * Server, when the request named a region: the region it used. With `region: "auto"` it is the
   * caller's country as the API's edge saw it, or null when unknown.
   */
  region?: string | null;
  /** Server: 0–1, how well its tiers understood the query. */
  confidence?: number;
  /** Server: no tier understood the query (`assessConfidence` with its own dictionary). */
  unsure?: boolean;
  /** Set by the provider that answered. */
  layer?: SemanticLayer;
}

export interface SemanticSearchOptions {
  locale?: string;
  limit?: number;
  signal?: AbortSignal;
  /**
   * `"auto"` asks the API to report the caller's region (`region=auto`, from the request's
   * country). Only `"auto"` is ever sent: a region code stays on the device.
   */
  region?: string;
}

/** The region value that asks the API for the caller's region. */
export const AUTO_REGION = "auto";

/** True for `"auto"` in any case. */
export const isAutoRegion = (region: string | undefined): boolean => region?.toLowerCase() === AUTO_REGION;

/**
 * A source of semantic results: precomputed shards, the HTTP API, or (later) an on-device
 * model. `undefined` means "no answer here" — the next provider is tried, and with none left the
 * client simply keeps its alias results.
 */
export interface SemanticProvider {
  search(query: string, options?: SemanticSearchOptions): Promise<SemanticResponse | undefined>;
  /**
   * The answer that is already in memory, without I/O: a loaded shard, or a response this client
   * received before. A session shows it at once, with no debounce.
   */
  peek?(query: string, options?: Omit<SemanticSearchOptions, "signal">): SemanticResponse | undefined;
  /**
   * Start loading what `peek` needs for this query (a shard index, the query's shard), so it is
   * there by the next keystroke. An empty query loads the indexes only. Never throws.
   */
  prefetch?(query: string, options?: Pick<SemanticSearchOptions, "locale">): void;
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
    peek(query, options) {
      for (const provider of providers) {
        const response = provider.peek?.(query, options);
        if (response) return response;
      }
      return undefined;
    },
    prefetch(query, options) {
      for (const provider of providers) provider.prefetch?.(query, options);
    },
  };
}
