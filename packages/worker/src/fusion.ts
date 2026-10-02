import type { SearchResult } from "emojisense";
import { familyKey } from "./emoji-lookup.ts";

/** One ranked list of evidence, best first, and how much its top result counts. */
export interface WeightedList {
  results: readonly SearchResult[];
  weight: number;
  /**
   * Also multiply by each result's own score. For alias lists, whose 0–1 score says how well
   * the phrase matched: an exact "keyboard" → ⌨️ (1.0) counts fully, "keyboard" → 😹 via the
   * phrase "keyboard cat" (0.58) about half.
   */
  byScore?: boolean;
}

export interface FuseListsOptions {
  /** Rank r (1-based) adds `weight · (k + 1) / (k + r)`, so rank 1 adds exactly `weight`. */
  k: number;
  limit: number;
  /** Results whose summed evidence is below this are dropped, even when the list is short. */
  floor: number;
  /** Summed evidence that is reported as score 1.0. */
  scale: number;
}

/**
 * Weighted reciprocal rank fusion of any number of lists (core's `fuseResults` takes exactly
 * alias + semantic). An emoji that several lists agree on rises; one that only a weak list holds
 * stays below `floor` and is dropped, so a short honest list beats a full one with weak
 * neighbours. Gender and direction variants keep only their best member. Each result keeps the
 * `source` of the list that added the most to it, and its score is the evidence / `scale`.
 */
export function fuseLists(lists: readonly WeightedList[], options: FuseListsOptions): SearchResult[] {
  const { k, limit, floor, scale } = options;
  const fused = new Map<string, { result: SearchResult; total: number; best: number; order: number }>();
  for (const { results, weight, byScore } of lists) {
    const seen = new Set<string>();
    results.forEach((result, index) => {
      if (seen.has(result.id)) return;
      seen.add(result.id);
      const added = ((weight * (k + 1)) / (k + index + 1)) * (byScore ? result.score : 1);
      const entry = fused.get(result.id);
      if (!entry) {
        fused.set(result.id, { result, total: added, best: added, order: fused.size });
        return;
      }
      entry.total += added;
      if (added > entry.best) {
        entry.best = added;
        entry.result = result;
      }
    });
  }

  const ranked = [...fused.values()].sort((a, b) => b.total - a.total || a.order - b.order);
  const families = new Set<string>();
  const out: SearchResult[] = [];
  for (const { result, total } of ranked) {
    if (total < floor || out.length >= limit) break;
    const family = familyKey(result.id);
    if (families.has(family)) continue;
    families.add(family);
    out.push({
      emoji: result.emoji,
      id: result.id,
      score: Math.round(Math.min(1, total / scale) * 1000) / 1000,
      source: result.source,
    });
  }
  return out;
}
