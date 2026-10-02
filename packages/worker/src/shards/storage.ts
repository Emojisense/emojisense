import {
  type BuiltShards,
  type ResultStore,
  SHARD_INDEX_FILE,
  type Shard,
  type ShardIndex,
  shardFileName,
  shardJson,
  utf8Bytes,
} from "@emojisense/data/shards";
import type { DayWindow } from "./select.ts";

/**
 * R2 layout (PACK_FORMAT §6, "Nightly builds"):
 *
 *   shards/<packVersion>/<contentHash>/current.json                   pointer to the served build
 *   shards/<packVersion>/<contentHash>/<build>/index.json             ShardIndex, English
 *   shards/<packVersion>/<contentHash>/<build>/<key>.json             Shard, file name encodeURIComponent(key)
 *   shards/<packVersion>/<contentHash>/<build>/<locale>/index.json    the same for another pack locale
 *   shards/<packVersion>/<contentHash>/<build>/<locale>/<key>.json
 *
 * One store per deployed pack version and content hash: answers depend on the vectors and the
 * model, so a deploy with new data starts a new store. `<build>` is a hash of the build's content
 * (every locale), so its files never change. English stays at the build root, where builds from
 * before locale shards put it.
 */
export const SHARD_ROOT = "shards/";
export const POINTER_FILE = "current.json";

/** The part of R2Bucket the shard store uses. R2Bucket satisfies it; tests use a Map. */
export interface ShardBucket {
  get(key: string): Promise<{ text(): Promise<string>; httpEtag: string } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  list(options: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string; uploaded: Date }[];
    delimitedPrefixes: string[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}

export interface ShardPointer {
  format: "emojisense-shard-pointer";
  formatVersion: 1;
  build: string;
  /**
   * The build before this one. Kept until the next run: an isolate trusts the pointer it read for
   * up to SHARD_POINTER_TTL_MS and may still serve that build.
   */
  previous: string | null;
  /** e.g. "bge-m3@1024" */
  model: string;
  /** Results stored per query. */
  results: number;
  /** Over every locale. */
  queries: number;
  shards: number;
  /** Per locale with a directory in the build. Missing in builds from before locale shards. */
  locales?: Record<string, { queries: number; shards: number }>;
  /** The days whose query_daily rows selected the queries. */
  window: DayWindow;
  /** UTC day of the last run that confirmed this pointer. */
  checkedDay: string;
}

const JSON_METADATA = { httpMetadata: { contentType: "application/json; charset=utf-8" } };

export const storePrefix = (packVersion: string, contentHash: string) =>
  `${SHARD_ROOT}${packVersion}/${contentHash}/`;

/** The directory of a locale's files in a build: the build root for English, else `<locale>/`. */
export const localeDir = (prefix: string, build: string, locale: string) =>
  locale === "en" ? `${prefix}${build}/` : `${prefix}${build}/${locale}/`;

export async function readPointer(bucket: ShardBucket, prefix: string): Promise<ShardPointer | undefined> {
  const object = await bucket.get(prefix + POINTER_FILE);
  if (!object) return undefined;
  const pointer = JSON.parse(await object.text()) as Partial<ShardPointer>;
  const valid = pointer.format === "emojisense-shard-pointer" && typeof pointer.build === "string";
  return valid ? (pointer as ShardPointer) : undefined;
}

export async function writePointer(
  bucket: ShardBucket,
  prefix: string,
  pointer: ShardPointer,
): Promise<void> {
  await bucket.put(prefix + POINTER_FILE, JSON.stringify(pointer), JSON_METADATA);
}

/** Runs `task` over `items` with at most `limit` in flight. */
export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await task(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** Copies every entry of one locale directory of a build (localeDir) into `store`; returns how many. */
export async function loadBuild(
  bucket: ShardBucket,
  dir: string,
  store: ResultStore,
  concurrency: number,
): Promise<number> {
  const indexObject = await bucket.get(dir + SHARD_INDEX_FILE);
  if (!indexObject) return 0;
  const index = JSON.parse(await indexObject.text()) as ShardIndex;
  let loaded = 0;
  await forEachLimit(index.keys, concurrency, async (key) => {
    const object = await bucket.get(dir + shardFileName(key));
    if (!object) return;
    const shard = JSON.parse(await object.text()) as Shard;
    for (const [q, results] of Object.entries(shard.entries)) {
      store.set(q, results);
      loaded++;
    }
  });
  return loaded;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The shards of one locale in a build. */
export interface LocaleShards {
  locale: string;
  built: BuiltShards;
}

/**
 * 16 hex digits over every locale's index and shard files: the same output gets the same id.
 * Locales are taken in the order given; the job sorts them.
 */
export async function buildId(locales: readonly LocaleShards[]): Promise<string> {
  const parts: string[] = [];
  for (const { locale, built } of locales) {
    parts.push(locale, JSON.stringify(built.index));
    for (const plan of built.plans) {
      parts.push(await sha256Hex(shardJson(plan.key, plan.queries, built.store)));
    }
  }
  return (await sha256Hex(parts.join("\n"))).slice(0, 16);
}

/**
 * Writes the shard files of one locale directory (localeDir), then its index.json. A run that
 * stops half way leaves a build that nothing points to; the next run deletes it (pruneBuilds).
 * Returns the raw bytes written.
 */
export async function writeBuild(
  bucket: ShardBucket,
  dir: string,
  built: BuiltShards,
  concurrency: number,
): Promise<number> {
  let bytes = 0;
  await forEachLimit(built.plans, concurrency, async (plan) => {
    const json = shardJson(plan.key, plan.queries, built.store);
    bytes += utf8Bytes(json);
    await bucket.put(dir + shardFileName(plan.key), json, JSON_METADATA);
  });
  const index = JSON.stringify(built.index);
  await bucket.put(dir + SHARD_INDEX_FILE, index, JSON_METADATA);
  return bytes + utf8Bytes(index);
}

async function listAll(bucket: ShardBucket, prefix: string, delimiter?: string) {
  const objects: { key: string; uploaded: Date }[] = [];
  const prefixes: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      limit: 1000,
      ...(delimiter ? { delimiter } : {}),
      ...(cursor ? { cursor } : {}),
    });
    objects.push(...page.objects);
    prefixes.push(...page.delimitedPrefixes);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { objects, prefixes };
}

async function deleteKeys(bucket: ShardBucket, keys: readonly string[]): Promise<number> {
  for (let start = 0; start < keys.length; start += 1000)
    await bucket.delete(keys.slice(start, start + 1000));
  return keys.length;
}

/** Deletes the builds under `prefix` other than `keep`; returns how many objects it deleted. */
export async function pruneBuilds(
  bucket: ShardBucket,
  prefix: string,
  keep: ReadonlySet<string>,
): Promise<number> {
  let deleted = 0;
  for (const dir of (await listAll(bucket, prefix, "/")).prefixes) {
    if (keep.has(dir.slice(prefix.length, -1))) continue;
    deleted += await deleteKeys(
      bucket,
      (await listAll(bucket, dir)).objects.map((o) => o.key),
    );
  }
  return deleted;
}

/**
 * Deletes the stores of other pack versions and content hashes in which nothing was written for
 * `staleDays`: their deployment is gone (a live one rewrites its pointer every night). Returns how
 * many objects it deleted.
 */
export async function pruneStaleStores(
  bucket: ShardBucket,
  current: string,
  now: number,
  staleDays: number,
): Promise<number> {
  const cutoff = now - staleDays * 24 * 3600 * 1000;
  let deleted = 0;
  for (const version of (await listAll(bucket, SHARD_ROOT, "/")).prefixes) {
    for (const store of (await listAll(bucket, version, "/")).prefixes) {
      if (store === current) continue;
      const { objects } = await listAll(bucket, store);
      if (objects.some((o) => o.uploaded.getTime() >= cutoff)) continue;
      deleted += await deleteKeys(
        bucket,
        objects.map((o) => o.key),
      );
    }
  }
  return deleted;
}
