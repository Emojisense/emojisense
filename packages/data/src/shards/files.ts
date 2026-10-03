import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { SHARD_INDEX_FILE, shardFileName, shardJson } from "./json.ts";
import type { ShardPlan } from "./split.ts";
import type { ResultStore } from "./store.ts";
import { isShardRows, type Shard, type ShardIndex } from "./types.ts";

/**
 * The budget is defined at gzip level 6, the usual level of on-the-fly HTTP compression. It is
 * ~4× faster than level 9, which matters for ~13k shards per 1M queries, and ~2.5% larger.
 */
export const gzipBytes = (text: string) => gzipSync(text, { level: 6 }).length;

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
  writeFileSync(join(dir, SHARD_INDEX_FILE), JSON.stringify(index));
  const gzip: number[] = [];
  for (const plan of plans) {
    const text = shardJson(plan.key, plan.queries, store);
    writeFileSync(join(dir, shardFileName(plan.key)), text);
    gzip.push(gzipBytes(text));
  }
  return { gzip };
}

export function readShardIndex(dir: string): ShardIndex | undefined {
  const path = join(dir, SHARD_INDEX_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ShardIndex) : undefined;
}

/**
 * Copy the entries of an earlier build into `store`: only queries in `wanted`, cut to `limit`
 * results, and only entries that have that many. The caller checks that the earlier build used
 * the same model and pack version.
 */
export function loadShardEntries(dir: string, wanted: ReadonlySet<string>, store: ResultStore): number {
  const index = readShardIndex(dir);
  if (!index) return 0;
  let loaded = 0;
  for (const key of index.keys) {
    const path = join(dir, shardFileName(key));
    if (!existsSync(path)) continue;
    const shard = JSON.parse(readFileSync(path, "utf8")) as Shard;
    for (const [q, results] of Object.entries(shard.entries)) {
      if (!wanted.has(q) || !isShardRows(results)) continue;
      store.set(q, results);
      loaded++;
    }
  }
  return loaded;
}
