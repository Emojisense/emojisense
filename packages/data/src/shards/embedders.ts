import { embeddingText } from "emojisense";
import { embedTexts, readCachedEmbeddings } from "../embeddings.ts";
import { type EmbeddingModel, formatQuery } from "../models.ts";
import type { QueryEmbedder } from "./resolvers.ts";

/**
 * What the API embeds for a query (packages/worker/src/semantic.ts): `embeddingText`, then the
 * model's query template. Shard keys come from logs of normalized text, which `embeddingText`
 * leaves as it is; it is applied so that both paths follow one rule.
 */
const queryInput = (model: EmbeddingModel, q: string) => formatQuery(model, embeddingText(q));

/** Workers AI (needs `wrangler login` or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID). */
export function workersAiEmbedder(model: EmbeddingModel): QueryEmbedder {
  return {
    async embed(queries) {
      const texts = queries.map((q) => queryInput(model, q));
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
        queries.map((q) => queryInput(model, q)),
        "query",
      );
    },
  };
}
