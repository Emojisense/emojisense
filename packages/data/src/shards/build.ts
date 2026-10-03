import { SHARD_INDEX_FILE, shardFileName, shardJson, utf8Bytes } from "./json.ts";
import { planShards, type ShardPlan } from "./split.ts";
import { createResultStore, type ResultStore } from "./store.ts";
import { type QueryCount, SHARD_FORMAT_VERSION, type ShardIndex, type ShardResolver } from "./types.ts";

export interface BuildShardsOptions {
  /** Aggregated queries (see aggregateQueries), most frequent first. */
  queries: readonly QueryCount[];
  /** Keeps only queries a client would send to the semantic layers (see createWorkerGate). */
  reachesWorker(query: QueryCount): boolean;
  resolver: ShardResolver;
  packVersion: string;
  /** Budget per shard file, in the unit of `shardBytes`. */
  maxShardBytes: number;
  /**
   * Size of one shard file as served. The CLI passes gzip (files.ts `gzipBytes`). Default: raw
   * UTF-8 bytes, for the Worker, which has no synchronous gzip.
   */
  shardBytes?: (json: string) => number;
  /** Queries per resolver call. Default 1000. */
  batchSize?: number;
  /** Fills `store` with reusable entries of the previous build; returns how many it added. */
  previous?: (wanted: ReadonlySet<string>, store: ResultStore) => number;
  onProgress?: (done: number, total: number) => void;
}

export interface BuildStats {
  queries: number;
  /** Answered on device with confidence, so they never reach the Worker. */
  answeredOnDevice: number;
  reused: number;
  resolved: number;
  /** The resolver had no answer (e.g. offline cache miss). These keep going to the API. */
  unresolved: number;
  shards: number;
  oversized: string[];
}

export interface BuiltShards {
  index: ShardIndex;
  plans: ShardPlan[];
  store: ResultStore;
  stats: BuildStats;
}

/** Gate → reuse → resolve → adaptive split. Writing the files is a separate step (writeShardDir). */
export async function buildShards(options: BuildShardsOptions): Promise<BuiltShards> {
  const { resolver } = options;
  const kept = options.queries.filter((q) => options.reachesWorker(q));
  const store = createResultStore();
  const reused = options.previous?.(new Set(kept.map((q) => q.q)), store) ?? 0;

  const todo = kept.map((q) => q.q).filter((q) => !store.has(q));
  const batchSize = options.batchSize ?? 1000;
  let resolved = 0;
  for (let start = 0; start < todo.length; start += batchSize) {
    const batch = todo.slice(start, start + batchSize);
    const answers = await resolver.resolve(batch);
    for (const q of batch) {
      const results = answers.get(q);
      if (!results || results.length === 0) continue;
      store.set(q, results);
      resolved++;
    }
    options.onProgress?.(Math.min(start + batchSize, todo.length), todo.length);
  }

  const measure = options.shardBytes ?? utf8Bytes;
  const planned = planShards([...store.queries()], {
    maxBytes: options.maxShardBytes,
    // +1 for the comma between entries.
    entryBytes: (q) => utf8Bytes(store.entryJson(q)) + 1,
    measure: (key, queries) => measure(shardJson(key, queries, store)),
    // Raw bytes need no measurement: the cheap sum decides alone.
    ...(options.shardBytes ? {} : { maxRatio: 1 }),
  });
  // The key "index" would be written over index.json. Its queries stay on the API.
  const plans = planned.plans.filter((p) => shardFileName(p.key) !== SHARD_INDEX_FILE);
  const { oversized } = planned;
  const index: ShardIndex = {
    format: "emojisense-shards",
    formatVersion: SHARD_FORMAT_VERSION,
    packVersion: options.packVersion,
    model: resolver.model,
    keys: plans.map((p) => p.key),
  };
  return {
    index,
    plans,
    store,
    stats: {
      queries: options.queries.length,
      answeredOnDevice: options.queries.length - kept.length,
      reused,
      resolved,
      unresolved: todo.length - resolved,
      shards: plans.length,
      oversized,
    },
  };
}
