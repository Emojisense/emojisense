import { getModel } from "@emojisense/data/models";
import { type AliasEngine, createEngine, decodeVectors, type Pack, type VectorIndex } from "emojisense";
import type { Env, GeneratedConfig } from "./env.ts";
import config from "./generated/config.json";
import packEn from "./generated/pack.en.json";
import packTr from "./generated/pack.tr.json";
import vectors from "./generated/vectors.bin";
import { type Catalog, corsHeaders, handleSearch, json } from "./search.ts";

// Built lazily on first use and then reused by every request this isolate serves.
let engine: AliasEngine | undefined;
let index: VectorIndex | undefined;

const catalog: Catalog = {
  config: config as GeneratedConfig,
  model: getModel(config.modelKey),
  engine: () => {
    engine ??= createEngine([packEn as unknown as Pack, packTr as unknown as Pack]);
    return engine;
  },
  index: () => {
    if (!index) {
      const decoded = decodeVectors(vectors);
      if (decoded.model !== config.modelId || decoded.dims !== config.dims) {
        throw new Error(
          `vector file is ${decoded.model}@${decoded.dims}, config says ${config.modelId}@${config.dims}`,
        );
      }
      index = decoded;
    }
    return index;
  },
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

    if (pathname === "/v1/search") return handleSearch(request, env, ctx, catalog, caches.default);
    if (pathname === "/v1/health") {
      return json({
        ok: true,
        packVersion: config.packVersion,
        model: `${config.modelKey}@${config.dims}`,
        semantic: Boolean(env.AI),
      });
    }
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
