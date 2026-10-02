import { createSemanticClient } from "./client.js";
import { chainProviders, type SemanticProvider } from "./provider.js";
import { createShardProvider } from "./shards.js";

export interface LayeredSemanticOptions {
  /** Layer 2, precomputed results as static files, e.g. "https://api.emojisense.com/p/0.1.0". */
  shardsUrl?: string;
  /** Layer 3, the HTTP API, e.g. "https://api.emojisense.com". */
  endpoint?: string;
  /** Publishable key (`pk_…`) for the API. Shards are free static files and need no key. */
  key?: string;
  /** Pin the data pack version so API results match the client's alias pack. */
  packVersion?: string;
  fetch?: typeof fetch;
}

/**
 * The semantic layers behind the on-device dictionary, cheapest first: shards (free asset
 * requests), then the API (metered). Each layer is optional. With neither configured this
 * returns `undefined`, so a search session stays fully on device and never waits on a debounce.
 */
export function createLayeredSemantic(options: LayeredSemanticOptions): SemanticProvider | undefined {
  const { shardsUrl, endpoint, key, packVersion, fetch } = options;
  const layers: SemanticProvider[] = [];
  if (shardsUrl) layers.push(createShardProvider({ baseUrl: shardsUrl, fetch }));
  if (endpoint) layers.push(createSemanticClient({ endpoint, key, packVersion, fetch }));
  return layers.length > 1 ? chainProviders(...layers) : layers[0];
}
