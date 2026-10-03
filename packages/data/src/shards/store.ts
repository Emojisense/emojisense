import type { ShardRow } from "./types.ts";

export interface ResultStore {
  set(query: string, rows: readonly ShardRow[]): void;
  get(query: string): ShardRow[] | undefined;
  has(query: string): boolean;
  readonly size: number;
  queries(): IterableIterator<string>;
  /** `"query":[[…],…]`: exactly the bytes `JSON.stringify(shard)` produces for this entry. */
  entryJson(query: string): string;
}

/**
 * Resolved entries in a compact form. 1M queries × 40 rows as JS arrays would need gigabytes, so
 * all entries share one growing Int32Array of (catalog slot, text × 1000, glyph × 1000) triples.
 * Rows hold three decimals, so the packing loses nothing. Replacing an entry appends a new copy;
 * the old one stays unused (a build sets each query once).
 */
export function createResultStore(): ResultStore {
  const emojiBySlot: string[] = [];
  const idBySlot: string[] = [];
  const slotById = new Map<string, number>();
  /** query → [start, row count] packed as start * 64 + count (count ≤ 63; a row holds ≤ 40). */
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

  const get = (query: string): ShardRow[] | undefined => {
    const packed = entries.get(query);
    if (packed === undefined) return undefined;
    const start = Math.floor(packed / 64);
    const end = start + (packed % 64) * 3;
    const rows: ShardRow[] = [];
    for (let i = start; i < end; i += 3) {
      const slot = pool[i] as number;
      rows.push([
        emojiBySlot[slot] as string,
        idBySlot[slot] as string,
        (pool[i + 1] as number) / 1000,
        (pool[i + 2] as number) / 1000,
      ]);
    }
    return rows;
  };

  return {
    set(query, rows) {
      if (rows.length > 63) throw new Error(`result store: ${rows.length} rows per query (max 63)`);
      if (used + rows.length * 3 > pool.length) {
        const grown = new Int32Array(Math.max(pool.length * 2, used + rows.length * 3));
        grown.set(pool);
        pool = grown;
      }
      entries.set(query, used * 64 + rows.length);
      for (const [emoji, id, text, glyph] of rows) {
        pool[used++] = slotOf(emoji, id);
        pool[used++] = Math.round(text * 1000);
        pool[used++] = Math.round(glyph * 1000);
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
