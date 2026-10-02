/**
 * Cost per 1M user searches on Cloudflare (Workers Paid, beyond included quotas).
 * Only searches that reach Tier 1 cost anything; Tier 0 runs on the user's device.
 */
export const PRICES = {
  workerRequestPerM: 0.3,
  cpuMsPerM: 0.02,
  /** $ per 1M input tokens. null = not published (embeddinggemma, see RESEARCH.md). */
  modelPerMTokens: {
    "@cf/baai/bge-small-en-v1.5": 0.02,
    "@cf/baai/bge-m3": 0.012,
    "@cf/google/embeddinggemma-300m": null,
    "@cf/qwen/qwen3-embedding-0.6b": 0.012,
  } as Record<string, number | null>,
};

export interface CostInputs {
  /** Share of searches that call Tier 1 (measured by the eval with the production gate). */
  semanticRate: number;
  /** Debounced requests per semantic search (pauses while typing produce extra requests). */
  requestsPerSemanticSearch: number;
  cacheHitRate: number;
  tokensPerQuery: number;
  modelId: string;
  cpuMsPerRequest: number;
  /** Price to assume when the model price is not published. */
  fallbackPerMTokens?: number;
}

export function costPerMillion(inputs: CostInputs) {
  const requests = 1e6 * inputs.semanticRate * inputs.requestsPerSemanticSearch;
  const misses = requests * (1 - inputs.cacheHitRate);
  const listed = PRICES.modelPerMTokens[inputs.modelId];
  const perMTokens = listed ?? inputs.fallbackPerMTokens ?? 0.02;
  const requestsUsd = (requests / 1e6) * PRICES.workerRequestPerM;
  const cpuUsd = ((requests * inputs.cpuMsPerRequest) / 1e6) * PRICES.cpuMsPerM;
  const aiUsd = ((misses * inputs.tokensPerQuery) / 1e6) * perMTokens;
  return {
    requests,
    requestsUsd,
    cpuUsd,
    aiUsd,
    totalUsd: requestsUsd + cpuUsd + aiUsd,
    priceAssumed: listed === null || listed === undefined,
  };
}
