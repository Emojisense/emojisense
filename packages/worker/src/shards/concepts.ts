import type { ShardResult } from "@emojisense/data/shards";
import { type AliasEngine, assessConfidence, mergeConcept, type SearchResult } from "emojisense";
import { CONCEPT_CACHE_DAYS } from "../concepts/config.ts";
import { createConceptStore } from "../concepts/store.ts";
import { conceptsEnabled, resolveConcept } from "../concepts/tier.ts";
import type { CacheLike } from "../context.ts";
import type { Env } from "../env.ts";
import type { Catalog } from "../semantic.ts";

export interface NightlyConceptStats {
  /** Published queries the concept step looked at. */
  checked: number;
  /** Of those, unsure: no confident alias coverage and a weak semantic list. */
  unsure: number;
  /** Unsure queries answered from concept_cache (no model call). */
  cached: number;
  /** Model calls made (the nightly budget). */
  asked: number;
  /** Unsure queries left for the API or the next night: the budget ran out, or a call failed. */
  skipped: number;
  /** Shard entries that now lead with concept results. */
  merged: number;
  /** concept_cache rows deleted for age. */
  pruned: number;
}

/** The nightly job keeps no edge copies: they would live in one data centre only. */
const NO_CACHE: CacheLike = { match: async () => undefined, put: async () => {}, delete: async () => false };
const DAY_MS = 24 * 3600 * 1000;

/**
 * The concept step of the nightly shard build (DECISIONS.md, "Concept tier for unsure
 * queries"). For each published query, most searched first: is it unsure with its locale's
 * dictionary and its semantic list (what the API would say)? Then its concept answer comes
 * from concept_cache, or from a model call within `maxCalls`, and is stored there, so the API
 * answers common entity queries with no model call. The shard entry leads with the concept
 * results ([emoji, hexcode, score], the format is unchanged), so shard clients get them free.
 */
export function createNightlyConcepts(
  env: Env,
  catalog: Catalog,
  options: { maxCalls: number; now: number; limit: number },
) {
  const stats: NightlyConceptStats = {
    checked: 0,
    unsure: 0,
    cached: 0,
    asked: 0,
    skipped: 0,
    merged: 0,
    pruned: 0,
  };
  const enabled = conceptsEnabled(env);
  const store = env.DB ? createConceptStore(env.DB) : undefined;
  let remaining = options.maxCalls;
  const pending: Promise<unknown>[] = [];

  /** The shard list of `query`, with its concept results first when it is unsure and has some. */
  async function merge(
    query: string,
    locale: string,
    engine: AliasEngine,
    list: readonly ShardResult[],
  ): Promise<ShardResult[]> {
    const results = [...list];
    if (!enabled) return results;
    stats.checked++;
    const semantic = results.map(([emoji, id, score]): SearchResult => ({ emoji, id, score, source: "semantic" }));
    const alias = engine.search(query, { locale, limit: options.limit });
    if (!assessConfidence(alias, semantic).unsure) return results;
    stats.unsure++;
    const outcome = await resolveConcept(
      {
        env,
        catalog,
        cache: NO_CACHE,
        waitUntil: (promise) => void pending.push(promise),
        origin: "https://nightly.invalid",
        now: options.now,
        store,
        // A cron run has time: wait for the model rather than leave the answer pending.
        timeoutMs: 60_000,
        allowModelCall: () => remaining > 0,
      },
      query,
      locale,
    );
    if (outcome.modelCall) {
      remaining--;
      stats.asked++;
    } else if (outcome.info.status === "ok" || outcome.info.status === "none") {
      stats.cached++;
    }
    if (outcome.info.status !== "ok" && outcome.info.status !== "none") stats.skipped++;
    if (outcome.results.length === 0) return results;
    stats.merged++;
    return mergeConcept(semantic, outcome.results, undefined, options.limit).map((r): ShardResult => [
      r.emoji,
      r.id,
      r.score,
    ]);
  }

  return {
    stats,
    merge,
    /** Wait for stores still in flight, then delete answers older than CONCEPT_CACHE_DAYS. */
    async finish(): Promise<void> {
      await Promise.allSettled(pending);
      if (!store) return;
      const before = options.now - CONCEPT_CACHE_DAYS * DAY_MS;
      const beforeDay = new Date(options.now - 7 * DAY_MS).toISOString().slice(0, 10);
      stats.pruned = await store.prune(before, beforeDay).catch(() => 0);
    },
  };
}
