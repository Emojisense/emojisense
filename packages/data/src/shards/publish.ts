import type { BuiltShards } from "./build.ts";
import { shardJson } from "./json.ts";
import type { ShardIndex } from "./types.ts";

/**
 * The published layout of one pack version (PACK_FORMAT.md §6), as paths relative to its
 * directory `p/<packVersion>/` in the CDN bucket:
 *
 *   index.json            live index, English
 *   <locale>/index.json   live index of another pack locale
 *   f/<hash>.json         shard files and base indexes, named by content
 *
 * Next to it, outside what clients read, `state/<packVersion>/` holds the build state: the base
 * manifest and one pointer per deployed data version (packages/worker/src/shards/storage.ts).
 */
export const CDN_ROOT = "p/";
export const STATE_ROOT = "state/";
export const SHARD_FILES_DIR = "f/";
export const BASE_MANIFEST_FILE = "base.json";

/** The live index of a locale: English at the version root, every other locale in its directory. */
export const liveIndexPath = (locale: string) => (locale === "en" ? "index.json" : `${locale}/index.json`);

/** The directory a locale's live index is in, relative to the version root: "" or "tr/". */
export const liveIndexDir = (locale: string) => (locale === "en" ? "" : `${locale}/`);

export const cdnVersionDir = (packVersion: string) => `${CDN_ROOT}${packVersion}/`;
export const stateVersionDir = (packVersion: string) => `${STATE_ROOT}${packVersion}/`;

/** A file to publish; `path` is relative to the version directory, e.g. "f/3f9a0c1d2e4b5a69.json". */
export interface PublishedFile {
  path: string;
  json: string;
}

/**
 * The base layer of a pack version: which base index each locale has. Written by the base build
 * (`build-shards.ts --layer base`), read by the nightly build, which names the base index in each
 * live index and leaves out the queries the base holds.
 */
export interface ShardBaseManifest {
  format: "emojisense-shard-base";
  formatVersion: 1;
  packVersion: string;
  model: string;
  /** Locale → its base index, relative to the version directory ("f/….json"). */
  locales: Record<string, string>;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A file named by its content: the first 16 hex digits of its SHA-256. */
export async function contentFile(json: string): Promise<PublishedFile> {
  return { path: `${SHARD_FILES_DIR}${(await sha256Hex(json)).slice(0, 16)}.json`, json };
}

/**
 * `path` (relative to the version directory) as a URL relative to a file in `dir`: "" for the
 * English index, "tr/" for a locale index, "f/" for a base index.
 */
export function relativeTo(dir: string, path: string): string {
  if (dir !== "" && path.startsWith(dir)) return path.slice(dir.length);
  return "../".repeat(dir.split("/").filter(Boolean).length) + path;
}

/** `relative` (a URL in an index in `dir`) as a path relative to the version directory. */
export function resolveFrom(dir: string, relative: string): string {
  const parts = dir.split("/").filter(Boolean);
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export interface HashedLayer {
  /** The index, its `files` relative to the directory it is published in. */
  index: ShardIndex;
  /** The shard files, named by content. */
  files: PublishedFile[];
  /** Key → file, relative to the version directory. */
  paths: Record<string, string>;
}

/** The shard files of a build, named by content, and the index that names them from `dir`. */
export async function hashLayer(built: BuiltShards, dir: string): Promise<HashedLayer> {
  const files: PublishedFile[] = [];
  const paths: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const plan of built.plans) {
    const file = await contentFile(shardJson(plan.key, plan.queries, built.store));
    files.push(file);
    paths[plan.key] = file.path;
    names[plan.key] = relativeTo(dir, file.path);
  }
  return { index: { ...built.index, files: names }, files, paths };
}
