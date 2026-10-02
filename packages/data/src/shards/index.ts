/**
 * The runtime-neutral part of the shard builder (no node:fs, no zlib): the nightly job in the API
 * Worker uses it, the CLI (build-shards.ts) adds file output and gzip budgets.
 */
export { type BuildShardsOptions, type BuildStats, type BuiltShards, buildShards } from "./build.ts";
export { SHARD_INDEX_FILE, shardFileName, shardJson, utf8Bytes } from "./json.ts";
export { type PrivacyReason, privacyReason } from "./privacy.ts";
export { createWorkerGate } from "./queries.ts";
export type { ShardPlan } from "./split.ts";
export { createResultStore, type ResultStore } from "./store.ts";
export type { QueryCount, Shard, ShardIndex, ShardResolver, ShardResult } from "./types.ts";
