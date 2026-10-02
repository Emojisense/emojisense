/**
 * Where published culture builds live, and what the deploy shipped.
 *
 * R2 layout, in the SHARDS bucket (the API Worker's bucket for nightly public files; the shard
 * store uses `shards/` only):
 *
 *   culture/<packVersion>/current.json                 pointer to the served build (or none)
 *   culture/<packVersion>/<build>/index.json           the culture index, with the live entries
 *   culture/<packVersion>/<build>/culture.<locale>.json
 *
 * `<build>` is a hash of the files, so they never change. The pointer names the deployed index
 * (`base`) the build was made from: after a deploy, the route serves the new deployed files until
 * a publish merges the live entries into them again (DECISIONS.md, "Culture Phase 2").
 */
import type { CultureEntryRecord, CulturePublishState } from "@emojisense/platform";
import { assertCulture, type Culture } from "emojisense";
import type { Env } from "../env.ts";
import { forEachLimit, type ShardBucket } from "../shards/storage.ts";

export const CULTURE_ROOT = "culture/";
export const CULTURE_POINTER_FILE = "current.json";
export const CULTURE_INDEX_FILE = "index.json";
const WRITE_CONCURRENCY = 6;

/** The part of R2Bucket the culture store uses (the same as the shard store's). */
export type CultureBucket = ShardBucket;

export interface CulturePointer extends CulturePublishState {
  format: "emojisense-culture-pointer";
  formatVersion: 1;
  /** The build served before this one; kept one more publish for isolates that read the old pointer. */
  previous: string | null;
  /** Hash of the live entries the build holds: the sync cron publishes again when it changes. */
  liveHash: string;
}

export interface CultureIndex {
  format: "emojisense-culture-index";
  formatVersion: 1;
  packVersion: string;
  from: string;
  until: string;
  locales: Record<string, { entries: number; bytes: number; gzipBytes: number }>;
  /** Published builds only: the build id and the live entries merged in. */
  build?: string;
  live?: string[];
}

export interface DeployedCulture {
  /** 16 hex digits of SHA-256 over the deployed index.json. */
  base: string;
  index: CultureIndex;
  /** Every locale file the index lists. */
  files: Map<string, Culture>;
}

const JSON_METADATA = { httpMetadata: { contentType: "application/json; charset=utf-8" } };

export const culturePrefix = (packVersion: string) => `${CULTURE_ROOT}${packVersion}/`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stable hash of the live entries a build holds. */
export async function liveHash(records: readonly CultureEntryRecord[]): Promise<string> {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  return (await sha256Hex(JSON.stringify(sorted))).slice(0, 16);
}

const assetUrl = (packVersion: string, file: string) =>
  `https://assets.local/v1/culture/${packVersion}/${file}`;

async function fetchAsset(env: Env, packVersion: string, file: string): Promise<string | undefined> {
  if (!env.ASSETS) throw new Error("ASSETS binding missing");
  const response = await env.ASSETS.fetch(assetUrl(packVersion, file));
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

/** The deployed index and its hash; undefined when the deploy shipped no culture files. */
export async function readDeployedIndex(
  env: Env,
  packVersion: string,
): Promise<{ base: string; index: CultureIndex } | undefined> {
  const text = await fetchAsset(env, packVersion, CULTURE_INDEX_FILE);
  if (text === undefined) return undefined;
  const index = JSON.parse(text) as CultureIndex;
  if (index.format !== "emojisense-culture-index" || index.packVersion !== packVersion) {
    throw new Error(`the deployed culture index is not for pack ${packVersion}`);
  }
  return { base: (await sha256Hex(text)).slice(0, 16), index };
}

/** The deployed index and every locale file it lists (the git entries, built at deploy). */
export async function readDeployedCulture(
  env: Env,
  packVersion: string,
): Promise<DeployedCulture | undefined> {
  const deployed = await readDeployedIndex(env, packVersion);
  if (!deployed) return undefined;
  const files = new Map<string, Culture>();
  for (const locale of Object.keys(deployed.index.locales)) {
    const text = await fetchAsset(env, packVersion, `culture.${locale}.json`);
    if (text === undefined) throw new Error(`culture.${locale}.json is listed but not deployed`);
    const culture: unknown = JSON.parse(text);
    assertCulture(culture);
    if (culture.locale !== locale || culture.packVersion !== packVersion) {
      throw new Error(`culture.${locale}.json does not match the deployed index`);
    }
    files.set(locale, culture);
  }
  return { ...deployed, files };
}

export async function readCulturePointer(
  bucket: CultureBucket,
  packVersion: string,
): Promise<CulturePointer | undefined> {
  const object = await bucket.get(culturePrefix(packVersion) + CULTURE_POINTER_FILE);
  if (!object) return undefined;
  const pointer = JSON.parse(await object.text()) as Partial<CulturePointer>;
  return pointer.format === "emojisense-culture-pointer" ? (pointer as CulturePointer) : undefined;
}

export async function writeCulturePointer(
  bucket: CultureBucket,
  packVersion: string,
  pointer: CulturePointer,
): Promise<void> {
  await bucket.put(culturePrefix(packVersion) + CULTURE_POINTER_FILE, JSON.stringify(pointer), JSON_METADATA);
}

/** Writes a build's files (name → JSON text). The pointer is written after it, by the caller. */
export async function writeCultureBuild(
  bucket: CultureBucket,
  packVersion: string,
  build: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  const dir = `${culturePrefix(packVersion)}${build}/`;
  const names = [...files.keys()].filter((n) => n !== CULTURE_INDEX_FILE);
  await forEachLimit(names, WRITE_CONCURRENCY, async (name) => {
    await bucket.put(dir + name, files.get(name) as string, JSON_METADATA);
  });
  const index = files.get(CULTURE_INDEX_FILE);
  if (index !== undefined) await bucket.put(dir + CULTURE_INDEX_FILE, index, JSON_METADATA);
}

/** Deletes the builds of this pack version other than `keep`; returns how many objects it deleted. */
export async function pruneCultureBuilds(
  bucket: CultureBucket,
  packVersion: string,
  keep: ReadonlySet<string>,
): Promise<number> {
  const prefix = culturePrefix(packVersion);
  const doomed: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const { key } of page.objects) {
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash > 0 && !keep.has(rest.slice(0, slash))) doomed.push(key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let start = 0; start < doomed.length; start += 1000) {
    await bucket.delete(doomed.slice(start, start + 1000));
  }
  return doomed.length;
}

/** The file of a build, or undefined when it does not exist. */
export async function readCultureFile(
  bucket: CultureBucket,
  packVersion: string,
  build: string,
  name: string,
): Promise<{ text: string; etag: string } | undefined> {
  const object = await bucket.get(`${culturePrefix(packVersion)}${build}/${name}`);
  return object ? { text: await object.text(), etag: object.httpEtag } : undefined;
}

/** Bytes of `text` after gzip (CompressionStream: Workers and Node have it). */
export async function gzipBytes(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}
