import { getModel } from "@emojisense/data/models";
import { vectorFileName } from "@emojisense/data/vector-files";
import {
  type AliasEngine,
  createEngine,
  decodeVectors,
  type Pack,
  type PackRow,
  type VectorIndex,
} from "emojisense";
import { createApp } from "./app.ts";
import { LOCALE_ENGINE_CACHE_SIZE, LOCALE_VECTOR_CACHE_SIZE } from "./config.ts";
import { assetCultureReader, createCultureFiles } from "./culture.ts";
import { createD1CustomEmojiReader } from "./custom-store.ts";
import type { Env, GeneratedConfig } from "./env.ts";
import config from "./generated/config.json";
import packEnExt from "./generated/pack.en.ext.json";
import packEn from "./generated/pack.en.json";
import packTrExt from "./generated/pack.tr.ext.json";
import packTr from "./generated/pack.tr.json";
import vectors from "./generated/vectors.bin";
import { assetPackReader, createLocaleEngines } from "./locale-engines.ts";
import { assetVectorReader, createLocaleVectors } from "./locale-vectors.ts";
import { handleScheduled } from "./retention.ts";
import type { Catalog } from "./semantic.ts";
import { createD1Store } from "./store.ts";

// Built lazily on first use and then reused by every request this isolate serves.
let engine: AliasEngine | undefined;
let index: VectorIndex | undefined;

const bundledEngine = () => {
  engine ??= createEngine([packEn, packTr, packEnExt, packTrExt] as unknown as Pack[]);
  return engine;
};
// The other pack locales are static assets; their engines are built on first use (core packs).
const localeEngines = createLocaleEngines({
  bundled: bundledEngine,
  base: () => [packEn as unknown as Pack],
  read: assetPackReader(config.packVersion),
  maxEngines: LOCALE_ENGINE_CACHE_SIZE,
});

// Culture files are static assets too, read on first use per locale and kept for the UTC day.
const cultureFiles = createCultureFiles({ read: assetCultureReader(config.packVersion) });

const sharedIndex = () => {
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
};
// The shared vectors are bundled; each locale's own vectors are static assets, read on first use.
const localeVectors = createLocaleVectors({
  shared: sharedIndex,
  locales: config.vectorLocales,
  fileOf: (locale) => vectorFileName(config.modelKey, config.dims, locale),
  read: assetVectorReader(config.packVersion, { model: config.modelId, dims: config.dims }),
  maxResident: LOCALE_VECTOR_CACHE_SIZE,
});

const catalog: Catalog = {
  config: config as GeneratedConfig,
  model: getModel(config.modelKey),
  engine: bundledEngine,
  aliasEngine: (locale, env) => localeEngines.get(locale, env),
  culture: (locale, env) => cultureFiles.get(locale, env),
  index: sharedIndex,
  vectors: (locale, env) => localeVectors.get(locale, env),
};

const app = createApp({
  catalog,
  cache: () => caches.default,
  store: (env) => (env.DB ? createD1Store(env.DB) : undefined),
  emojiSets: { rows: () => packEn.emoji as unknown as PackRow[] },
  customEmoji: (env) => (env.DB ? createD1CustomEmojiReader(env.DB) : undefined),
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (controller, env) => handleScheduled(env, controller.scheduledTime),
} satisfies ExportedHandler<Env>;
