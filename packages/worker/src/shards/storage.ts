import {
  BASE_MANIFEST_FILE,
  CDN_ROOT,
  cdnVersionDir,
  type HashedLayer,
  isShardRows,
  type PublishedFile,
  type ResultStore,
  resolveFrom,
  SHARD_FILES_DIR,
  type Shard,
  type ShardBaseManifest,
  type ShardIndex,
  STATE_ROOT,
  stateVersionDir,
  utf8Bytes,
} from "@emojisense/data/shards";
import { SHARD_FILE_CACHE, SHARD_INDEX_BROWSER_CACHE } from "../config.ts";
import type { DayWindow } from "./select.ts";

/**
 * R2 layout, in the CDN bucket (PACK_FORMAT §6). The bucket is public on cdn.emojisense.*, where
 * clients read `p/` without a Worker; the API Worker serves the same files at /p/* for older
 * clients.
 *
 *   p/<packVersion>/index.json             live index, English (rewritten by every run)
 *   p/<packVersion>/<locale>/index.json    live index of another pack locale
 *   p/<packVersion>/f/<hash>.json          shard files and base indexes, named by content
 *   state/<packVersion>/base.json          base manifest (the base build, build-shards.ts)
 *   state/<packVersion>/<contentHash>.json pointer: the live build of this data
 *
 * One pointer per deployed pack version and content hash: answers depend on the vectors and the
 * model, so a deploy with new data does not reuse the entries of the old one.
 */

/** The part of R2Bucket the shard store uses. R2Bucket satisfies it; tests use a Map. */
export interface ShardBucket {
  get(key: string): Promise<{ text(): Promise<string>; httpEtag: string } | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  list(options: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string; uploaded: Date }[];
    delimitedPrefixes: string[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}

/** The live files of one locale: key → file, relative to the version directory. */
export interface LocaleBuild {
  queries: number;
  shards: number;
  files: Record<string, string>;
}

export interface ShardPointer {
  format: "emojisense-shard-pointer";
  formatVersion: 2;
  build: string;
  /** e.g. "embeddinggemma@768" */
  model: string;
  /**
   * 2: the build's shards hold model output (core `SemanticRow`), so its entries can be reused
   * whatever the ranking policy. Absent in builds whose shards held policy scores.
   */
  shardFormat?: number;
  /** Over every locale. */
  queries: number;
  shards: number;
  locales: Record<string, LocaleBuild>;
  /**
   * The build before this one. Its files are kept until the next run: clients keep an index for
   * up to an hour (SHARD_INDEX_BROWSER_CACHE).
   */
  previous: { build: string; locales: Record<string, LocaleBuild> } | null;
  /** The days whose query_daily rows selected the queries. */
  window: DayWindow;
  /** UTC day of the last run that confirmed this pointer. */
  checkedDay: string;
}

const JSON_TYPE = "application/json; charset=utf-8";
const PRIVATE = { httpMetadata: { contentType: JSON_TYPE, cacheControl: "no-store" } };

export const pointerKey = (packVersion: string, contentHash: string) =>
  `${stateVersionDir(packVersion)}${contentHash}.json`;

const baseManifestKey = (packVersion: string) => `${stateVersionDir(packVersion)}${BASE_MANIFEST_FILE}`;

async function readJson<T>(bucket: ShardBucket, key: string): Promise<T | undefined> {
  const object = await bucket.get(key);
  return object ? (JSON.parse(await object.text()) as T) : undefined;
}

export async function readPointer(
  bucket: ShardBucket,
  packVersion: string,
  contentHash: string,
): Promise<ShardPointer | undefined> {
  const pointer = await readJson<Partial<ShardPointer>>(bucket, pointerKey(packVersion, contentHash));
  const valid = pointer?.format === "emojisense-shard-pointer" && pointer.formatVersion === 2;
  return valid ? (pointer as ShardPointer) : undefined;
}

export async function writePointer(
  bucket: ShardBucket,
  packVersion: string,
  contentHash: string,
  pointer: ShardPointer,
): Promise<void> {
  await bucket.put(pointerKey(packVersion, contentHash), JSON.stringify(pointer), PRIVATE);
}

export async function readBaseManifest(
  bucket: ShardBucket,
  packVersion: string,
): Promise<ShardBaseManifest | undefined> {
  const manifest = await readJson<Partial<ShardBaseManifest>>(bucket, baseManifestKey(packVersion));
  return manifest?.format === "emojisense-shard-base" ? (manifest as ShardBaseManifest) : undefined;
}

export async function writeBaseManifest(bucket: ShardBucket, manifest: ShardBaseManifest): Promise<void> {
  await bucket.put(baseManifestKey(manifest.packVersion), JSON.stringify(manifest), PRIVATE);
}

/** A published file (index or shard), by its path relative to the version directory. */
export const readPublished = <T>(bucket: ShardBucket, packVersion: string, path: string) =>
  readJson<T>(bucket, cdnVersionDir(packVersion) + path);

/** A live index: cached for an hour, because the next run replaces it. */
export async function writeLiveIndex(
  bucket: ShardBucket,
  packVersion: string,
  path: string,
  index: ShardIndex,
): Promise<number> {
  const json = JSON.stringify(index);
  await bucket.put(cdnVersionDir(packVersion) + path, json, {
    httpMetadata: { contentType: JSON_TYPE, cacheControl: SHARD_INDEX_BROWSER_CACHE },
  });
  return utf8Bytes(json);
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

/** Copies every entry of the given shard files into `store`; returns how many. */
export async function loadEntries(
  bucket: ShardBucket,
  packVersion: string,
  files: Record<string, string>,
  store: ResultStore,
  concurrency: number,
): Promise<number> {
  let loaded = 0;
  await forEachLimit(Object.values(files), concurrency, async (path) => {
    const shard = await readPublished<Shard>(bucket, packVersion, path);
    for (const [q, rows] of Object.entries(shard?.entries ?? {})) {
      if (!isShardRows(rows)) continue;
      store.set(q, rows);
      loaded++;
    }
  });
  return loaded;
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

/** The content-named files of a version that are in the bucket, by path ("f/….json"). */
export async function listFiles(bucket: ShardBucket, packVersion: string): Promise<Map<string, Date>> {
  const dir = cdnVersionDir(packVersion);
  const { objects } = await listAll(bucket, dir + SHARD_FILES_DIR);
  return new Map(objects.map((o) => [o.key.slice(dir.length), o.uploaded]));
}

/**
 * Writes the files that are not in the bucket yet: a file is named by its content, so one that
 * exists is the same file. Returns the raw bytes written.
 */
export async function writeFiles(
  bucket: ShardBucket,
  packVersion: string,
  files: readonly PublishedFile[],
  existing: ReadonlyMap<string, unknown>,
  concurrency: number,
): Promise<number> {
  let bytes = 0;
  const missing = files.filter((file) => !existing.has(file.path));
  await forEachLimit(missing, concurrency, async (file) => {
    bytes += utf8Bytes(file.json);
    await bucket.put(cdnVersionDir(packVersion) + file.path, file.json, {
      httpMetadata: { contentType: JSON_TYPE, cacheControl: SHARD_FILE_CACHE },
    });
  });
  return bytes;
}

/** 16 hex digits over every locale's files: the same output gets the same id. */
export async function buildId(layers: readonly { locale: string; layer: HashedLayer }[]): Promise<string> {
  const text = layers.map(({ locale, layer }) => `${locale}\n${JSON.stringify(layer.index)}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** The base index of every locale in the manifest and the files it names. */
export async function baseFiles(
  bucket: ShardBucket,
  packVersion: string,
  manifest: ShardBaseManifest | undefined,
): Promise<string[]> {
  const paths: string[] = [];
  for (const indexPath of Object.values(manifest?.locales ?? {})) {
    paths.push(indexPath);
    const index = await readPublished<ShardIndex>(bucket, packVersion, indexPath);
    for (const file of Object.values(index?.files ?? {})) paths.push(resolveFrom(SHARD_FILES_DIR, file));
  }
  return paths;
}

/** Every live file that a pointer of this version names (any data version, current or previous build). */
export async function pointerFiles(bucket: ShardBucket, packVersion: string): Promise<string[]> {
  const paths: string[] = [];
  const { objects } = await listAll(bucket, stateVersionDir(packVersion));
  for (const { key } of objects) {
    if (key.endsWith(`/${BASE_MANIFEST_FILE}`)) continue;
    const pointer = await readJson<Partial<ShardPointer>>(bucket, key);
    for (const locales of [pointer?.locales, pointer?.previous?.locales]) {
      for (const build of Object.values(locales ?? {})) paths.push(...Object.values(build.files));
    }
  }
  return paths;
}

async function deleteKeys(bucket: ShardBucket, keys: readonly string[]): Promise<number> {
  for (let start = 0; start < keys.length; start += 1000)
    await bucket.delete(keys.slice(start, start + 1000));
  return keys.length;
}

/**
 * Deletes the content-named files of a version that nothing names any more, once they are older
 * than `graceMs` (a run that is still writing must not lose its files). Returns how many.
 */
export async function pruneFiles(
  bucket: ShardBucket,
  packVersion: string,
  existing: ReadonlyMap<string, Date>,
  referenced: ReadonlySet<string>,
  now: number,
  graceMs: number,
): Promise<number> {
  const unused = [...existing]
    .filter(([path, uploaded]) => !referenced.has(path) && uploaded.getTime() < now - graceMs)
    .map(([path]) => cdnVersionDir(packVersion) + path);
  return deleteKeys(bucket, unused);
}

/**
 * Deletes what other deployments left behind once nothing was written there for `staleDays`: the
 * pointers of other data versions of this pack version (their files are then unused and go in a
 * later run), and every file of other pack versions. A live deployment rewrites its pointer every
 * night. Returns how many objects it deleted.
 */
export async function pruneStale(
  bucket: ShardBucket,
  packVersion: string,
  contentHash: string,
  now: number,
  staleDays: number,
): Promise<number> {
  const cutoff = now - staleDays * 24 * 3600 * 1000;
  const current = pointerKey(packVersion, contentHash);
  let deleted = 0;
  const { objects: pointers } = await listAll(bucket, stateVersionDir(packVersion));
  const stalePointers = pointers.filter(
    (o) => o.key !== current && !o.key.endsWith(`/${BASE_MANIFEST_FILE}`) && o.uploaded.getTime() < cutoff,
  );
  deleted += await deleteKeys(
    bucket,
    stalePointers.map((o) => o.key),
  );

  for (const root of [CDN_ROOT, STATE_ROOT]) {
    for (const version of (await listAll(bucket, root, "/")).prefixes) {
      if (version === `${root}${packVersion}/`) continue;
      const { objects } = await listAll(bucket, version);
      if (objects.some((o) => o.uploaded.getTime() >= cutoff)) continue;
      deleted += await deleteKeys(
        bucket,
        objects.map((o) => o.key),
      );
    }
  }
  return deleted;
}
