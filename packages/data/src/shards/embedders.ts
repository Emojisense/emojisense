import { embedTexts, readCachedEmbeddings } from "../embeddings.ts";
import { type EmbeddingModel, formatQuery } from "../models.ts";
import type { QueryEmbedder } from "./resolvers.ts";

/** Workers AI (needs `wrangler login` or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID). */
export function workersAiEmbedder(model: EmbeddingModel): QueryEmbedder {
  return {
    async embed(queries) {
      const texts = queries.map((q) => formatQuery(model, q));
      return (await embedTexts(model, texts, "query", { persist: false })).vectors;
    },
  };
}

/**
 * Offline: only queries whose embedding is already in `.cache/embeddings` (written by
 * `pnpm eval` and `embed`). The others stay unresolved and keep going to the API.
 */
export function cachedEmbedder(model: EmbeddingModel): QueryEmbedder {
  return {
    async embed(queries) {
      return readCachedEmbeddings(
        model,
        queries.map((q) => formatQuery(model, q)),
        "query",
      );
    },
  };
}
