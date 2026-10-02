import { getModel } from "@emojisense/data/models";
import {
  type AliasEngine,
  createEngine,
  decodeVectors,
  type Pack,
  type PackRow,
  type VectorIndex,
} from "emojisense";
import { createApp } from "./app.ts";
import type { Env, GeneratedConfig } from "./env.ts";
import config from "./generated/config.json";
import packEnExt from "./generated/pack.en.ext.json";
import packEn from "./generated/pack.en.json";
import packTrExt from "./generated/pack.tr.ext.json";
import packTr from "./generated/pack.tr.json";
import vectors from "./generated/vectors.bin";
import { handleScheduled } from "./retention.ts";
import type { Catalog } from "./semantic.ts";
import { createD1Store } from "./store.ts";

// Built lazily on first use and then reused by every request this isolate serves.
let engine: AliasEngine | undefined;
let index: VectorIndex | undefined;

const catalog: Catalog = {
  config: config as GeneratedConfig,
  model: getModel(config.modelKey),
  engine: () => {
    engine ??= createEngine([packEn, packTr, packEnExt, packTrExt] as unknown as Pack[]);
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

const app = createApp({
  catalog,
  cache: () => caches.default,
  store: (env) => (env.DB ? createD1Store(env.DB) : undefined),
  emojiSets: { rows: () => packEn.emoji as unknown as PackRow[] },
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (controller, env) => handleScheduled(env, controller.scheduledTime),
} satisfies ExportedHandler<Env>;
