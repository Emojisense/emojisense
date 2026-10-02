import type { ShardResult } from "./types.ts";

export interface ResultStore {
  set(query: string, results: readonly ShardResult[]): void;
  get(query: string): ShardResult[] | undefined;
  has(query: string): boolean;
  readonly size: number;
  queries(): IterableIterator<string>;
  /** `"query":[[…],…]`: exactly the bytes `JSON.stringify(shard)` produces for this entry. */
  entryJson(query: string): string;
}

/**
 * Resolved entries in a compact form. 1M queries × 24 results as JS arrays would need gigabytes,
 * so all entries share one growing Int32Array of (catalog slot, score × 1000) pairs. The Worker
 * rounds scores to three decimals as well, so the packing loses nothing. Replacing an entry
 * appends a new copy; the old one stays unused (a build sets each query once).
 */
export function createResultStore(): ResultStore {
  const emojiBySlot: string[] = [];
  const idBySlot: string[] = [];
  const slotById = new Map<string, number>();
  /** query → [start, pair count] packed as start * 64 + count (count ≤ 50, the API limit). */
  const entries = new Map<string, number>();
  let pool = new Int32Array(1 << 16);
  let used = 0;

  const slotOf = (emoji: string, id: string) => {
    let slot = slotById.get(id);
    if (slot === undefined) {
      slot = idBySlot.length;
      slotById.set(id, slot);
      idBySlot.push(id);
      emojiBySlot.push(emoji);
    }
    return slot;
  };

  const get = (query: string): ShardResult[] | undefined => {
    const packed = entries.get(query);
    if (packed === undefined) return undefined;
    const start = Math.floor(packed / 64);
    const end = start + (packed % 64) * 2;
    const results: ShardResult[] = [];
    for (let i = start; i < end; i += 2) {
      const slot = pool[i] as number;
      results.push([emojiBySlot[slot] as string, idBySlot[slot] as string, (pool[i + 1] as number) / 1000]);
    }
    return results;
  };

  return {
    set(query, results) {
      if (results.length > 63) throw new Error(`result store: ${results.length} results per query (max 63)`);
      if (used + results.length * 2 > pool.length) {
        const grown = new Int32Array(Math.max(pool.length * 2, used + results.length * 2));
        grown.set(pool);
        pool = grown;
      }
      entries.set(query, used * 64 + results.length);
      for (const [emoji, id, score] of results) {
        pool[used++] = slotOf(emoji, id);
        pool[used++] = Math.round(score * 1000);
      }
    },
    get,
    has: (query) => entries.has(query),
    get size() {
      return entries.size;
    },
    queries: () => entries.keys(),
    entryJson: (query) => `${JSON.stringify(query)}:${JSON.stringify(get(query) ?? [])}`,
  };
}
