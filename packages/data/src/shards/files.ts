import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { ShardPlan } from "./split.ts";
import type { ResultStore } from "./store.ts";
import type { Shard, ShardIndex } from "./types.ts";

/** The JSON text of one shard file; equal to `JSON.stringify(shard)` for the same entries. */
export function shardJson(key: string, queries: readonly string[], store: ResultStore): string {
  return `{"key":${JSON.stringify(key)},"entries":{${queries.map((q) => store.entryJson(q)).join(",")}}}`;
}

/**
 * The budget is defined at gzip level 6, the usual level of on-the-fly HTTP compression. It is
 * ~4× faster than level 9, which matters for ~13k shards per 1M queries, and ~2.5% larger.
 */
export const gzipBytes = (text: string) => gzipSync(text, { level: 6 }).length;

export const shardFileName = (key: string) => `${encodeURIComponent(key)}.json`;

/**
 * Replace `dir` with index.json and one file per key. The directory is cleared first, so keys
 * from an older build cannot linger next to the new index.
 */
export function writeShardDir(
  dir: string,
  index: ShardIndex,
  plans: readonly ShardPlan[],
  store: ResultStore,
): { gzip: number[] } {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  const gzip: number[] = [];
  for (const plan of plans) {
    const text = shardJson(plan.key, plan.queries, store);
    writeFileSync(join(dir, shardFileName(plan.key)), text);
    gzip.push(gzipBytes(text));
  }
  return { gzip };
}

export function readShardIndex(dir: string): ShardIndex | undefined {
  const path = join(dir, "index.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ShardIndex) : undefined;
}

/**
 * Copy the entries of an earlier build into `store`: only queries in `wanted`, cut to `limit`
 * results, and only entries that have that many. The caller checks that the earlier build used
 * the same model and pack version.
 */
export function loadShardEntries(
  dir: string,
  wanted: ReadonlySet<string>,
  limit: number,
  store: ResultStore,
): number {
  const index = readShardIndex(dir);
  if (!index) return 0;
  let loaded = 0;
  for (const key of index.keys) {
    const path = join(dir, shardFileName(key));
    if (!existsSync(path)) continue;
    const shard = JSON.parse(readFileSync(path, "utf8")) as Shard;
    for (const [q, results] of Object.entries(shard.entries)) {
      if (!wanted.has(q) || results.length < limit) continue;
      store.set(q, results.slice(0, limit));
      loaded++;
    }
  }
  return loaded;
}
