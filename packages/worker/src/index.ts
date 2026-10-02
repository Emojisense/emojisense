import { WorkerEntrypoint } from "cloudflare:workers";
import exclusionsText from "@emojisense/data/culture/exclusions.txt";
import promptText from "@emojisense/data/culture/prompts/propose.v2.md";
import calendarSource from "@emojisense/data/culture/sources/calendar.json";
import eventsSource from "@emojisense/data/culture/sources/events.json";
import type { DatedSource, SlangSource, SourceFile } from "@emojisense/data/culture-core";
import { getModel } from "@emojisense/data/models";
import { vectorFileName } from "@emojisense/data/vector-files";
import type { CultureAdminRpc } from "@emojisense/platform";
import { type AliasEngine, createEngine, type Pack, type PackRow } from "emojisense";
import { decodeVectors, type VectorIndex } from "emojisense/vectors";
// The in-house eval suite (never the held-out one): the canonical answers the culture gate keeps.
import gateQueriesText from "../../eval/queries/queries.jsonl";
import { createApp } from "./app.ts";
import { LOCALE_ENGINE_CACHE_SIZE, LOCALE_VECTOR_CACHE_SIZE } from "./config.ts";
import { assetCultureReader, createCultureFiles } from "./culture.ts";
import { createCultureRuntime } from "./culture-admin/bundle.ts";
import { createCultureOverride, overrideCultureReader } from "./culture-admin/route.ts";
import { createCultureAdmin } from "./culture-admin/service.ts";
import { createD1CustomEmojiReader } from "./custom-store.ts";
import type { Env, GeneratedConfig } from "./env.ts";
import config from "./generated/config.json";
import packEnExt from "./generated/pack.en.ext.json";
import packEn from "./generated/pack.en.json";
import packTrExt from "./generated/pack.tr.ext.json";
import packTr from "./generated/pack.tr.json";
import vectors from "./generated/vectors.bin";
import glyphVectors from "./generated/vectors.glyph.bin";
import { assetPackReader, createLocaleEngines } from "./locale-engines.ts";
import { assetVectorReader, createLocaleVectors } from "./locale-vectors.ts";
import { runScheduled } from "./scheduled.ts";
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

// Culture files: the published R2 build (approved live entries merged in) when there is one for
// this deployment, else the static assets. Read on first use per locale, kept for the UTC day or
// until the next publish.
const cultureOverride = createCultureOverride({ packVersion: config.packVersion });
const cultureFiles = createCultureFiles({
  read: overrideCultureReader(config.packVersion, cultureOverride, assetCultureReader(config.packVersion)),
  version: (env) => cultureOverride.build(env),
});

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
// The glyph vectors (PACK_FORMAT §5) are bundled too; an empty file means this build has none.
let glyph: VectorIndex | null | undefined;
const glyphIndex = () => {
  if (glyph === undefined) {
    const decoded = decodeVectors(glyphVectors);
    if (decoded.ids.length > 0 && (decoded.model !== config.modelId || decoded.dims !== config.dims)) {
      throw new Error(
        `glyph vector file is ${decoded.model}@${decoded.dims}, config says ${config.modelId}@${config.dims}`,
      );
    }
    glyph = decoded.ids.length > 0 ? decoded : null;
  }
  return glyph ?? undefined;
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
  glyph: glyphIndex,
  vectors: (locale, env) => localeVectors.get(locale, env),
};

// Culture Phase 2: the nightly proposal job, publishing and the admin RPC (culture-admin/).
const cultureRuntime = createCultureRuntime({
  packVersion: config.packVersion,
  packRows: packEn.emoji as unknown as PackRow[],
  exclusions: exclusionsText,
  prompt: promptText,
  gateQueries: gateQueriesText,
  sources: [calendarSource, eventsSource] as unknown as SourceFile<DatedSource | SlangSource>[],
  engine: (locale, env) => localeEngines.get(locale, env),
});

/**
 * The search path's lookups (keys, account usage, custom emoji) only read. With D1 read
 * replication on, the nearest replica answers them; without it, the primary does. A new session
 * per statement: none of these reads depends on a write of the same request.
 */
const replicaReads = (db: D1Database) => ({
  prepare: (sql: string) => db.withSession("first-unconstrained").prepare(sql),
});

const app = createApp({
  catalog,
  cultureOverride,
  cache: () => caches.default,
  store: (env) => (env.DB ? createD1Store(env.DB, replicaReads(env.DB)) : undefined),
  emojiSets: { rows: () => packEn.emoji as unknown as PackRow[] },
  customEmoji: (env) => (env.DB ? createD1CustomEmojiReader(replicaReads(env.DB)) : undefined),
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (controller, env) => runScheduled(controller, env, catalog, cultureRuntime),
} satisfies ExportedHandler<Env>;

const cultureAdmin = (env: Env) => createCultureAdmin(env, cultureRuntime);

/**
 * The culture admin RPC entrypoint. Only a service binding reaches it (the dashboard's
 * CULTURE_ADMIN, after its ADMIN_EMAILS check); it has no URL.
 */
export class CultureAdmin extends WorkerEntrypoint<Env> implements CultureAdminRpc {
  overview(query: Parameters<CultureAdminRpc["overview"]>[0]) {
    return cultureAdmin(this.env).overview(query);
  }
  proposal(id: string) {
    return cultureAdmin(this.env).proposal(id);
  }
  preview(record: Parameters<CultureAdminRpc["preview"]>[0]) {
    return cultureAdmin(this.env).preview(record);
  }
  update(...args: Parameters<CultureAdminRpc["update"]>) {
    return cultureAdmin(this.env).update(...args);
  }
  approve(...args: Parameters<CultureAdminRpc["approve"]>) {
    return cultureAdmin(this.env).approve(...args);
  }
  reject(...args: Parameters<CultureAdminRpc["reject"]>) {
    return cultureAdmin(this.env).reject(...args);
  }
  retire(...args: Parameters<CultureAdminRpc["retire"]>) {
    return cultureAdmin(this.env).retire(...args);
  }
  publish() {
    return cultureAdmin(this.env).publish();
  }
  exportLive(input: Parameters<CultureAdminRpc["exportLive"]>[0]) {
    return cultureAdmin(this.env).exportLive(input);
  }
}
