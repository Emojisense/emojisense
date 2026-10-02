/** One shard file: its key and the queries it holds, in sorted order. */
export interface ShardPlan {
  key: string;
  queries: string[];
}

export interface SplitOptions {
  /** Size budget of one shard file (gzip bytes in production). */
  maxBytes: number;
  /** Exact size of a shard file with these entries. May be expensive (gzip). */
  measure(key: string, queries: readonly string[]): number;
  /** Cheap size of one entry (raw JSON bytes). Used to skip `measure` when the answer is obvious. */
  entryBytes(query: string): number;
  /**
   * Entries whose raw size is above `maxBytes × maxRatio` cannot fit after compression, so they
   * are split without measuring. Default 8 (shard JSON compresses about 4×).
   */
  maxRatio?: number;
}

export interface SplitOutput {
  plans: ShardPlan[];
  /** Keys that are over budget because the key could not get longer (file name limit). */
  oversized: string[];
}

/** Encoded file names stay well below the 255-byte limit of common file systems. */
const MAX_ENCODED_KEY = 200;

interface Range {
  key: string;
  start: number;
  end: number;
}

/**
 * Adaptive prefix split (PACK_FORMAT.md §6). Start with one key per first character. When a
 * shard is over budget, its largest next-character groups move out to longer keys ("t" → "th"
 * → "the ") until the rest fits; the small groups stay in the shorter key. Each query lands in
 * the shard of the longest key that is a prefix of it, which is the rule clients use to find it.
 *
 * Keys grow by whole code points, so a key never ends inside a surrogate pair (it must survive
 * `encodeURIComponent`).
 */
export function planShards(queries: readonly string[], options: SplitOptions): SplitOutput {
  const maxRatio = options.maxRatio ?? 8;
  // Code-unit order keeps every prefix group contiguous, so a group is a [start, end) range.
  const sorted = [...new Set(queries)].sort();
  const offsets = new Float64Array(sorted.length + 1);
  sorted.forEach((q, i) => {
    offsets[i + 1] = (offsets[i] as number) + options.entryBytes(q);
  });
  const rawBytes = (ranges: readonly Range[]) =>
    ranges.reduce((sum, r) => sum + (offsets[r.end] as number) - (offsets[r.start] as number), 0);
  const members = (ranges: readonly Range[]) => ranges.flatMap((r) => sorted.slice(r.start, r.end));

  const fits = (key: string, ranges: readonly Range[]) => {
    const raw = rawBytes(ranges);
    if (raw <= options.maxBytes) return true;
    if (raw > options.maxBytes * maxRatio) return false;
    return options.measure(key, members(ranges)) <= options.maxBytes;
  };

  /** Split [start, end) of queries that all start with `prefix` by their next code point. */
  const childrenOf = (prefix: string, start: number, end: number): Range[] => {
    const children: Range[] = [];
    let i = start;
    while (i < end) {
      const codePoint = (sorted[i] as string).codePointAt(prefix.length) as number;
      const key = prefix + String.fromCodePoint(codePoint);
      let j = i + 1;
      while (j < end && (sorted[j] as string).startsWith(key)) j++;
      children.push({ key, start: i, end: j });
      i = j;
    }
    return children;
  };

  const plans: ShardPlan[] = [];
  const oversized: string[] = [];
  const emit = (key: string, ranges: Range[]) => {
    const queriesInShard = members(ranges);
    if (queriesInShard.length > 0) plans.push({ key, queries: queriesInShard });
  };

  const visit = (group: Range) => {
    const whole = [group];
    if (fits(group.key, whole)) {
      emit(group.key, whole);
      return;
    }
    // Sorted order puts the query equal to the key (if any) first; it can only live here.
    let exactEnd = group.start;
    while (exactEnd < group.end && sorted[exactEnd] === group.key) exactEnd++;
    const exact: Range = { key: group.key, start: group.start, end: exactEnd };
    const children = childrenOf(group.key, exactEnd, group.end);
    if (children.length === 0 || encodeURIComponent(group.key).length + 12 > MAX_ENCODED_KEY) {
      oversized.push(group.key);
      emit(group.key, whole);
      return;
    }

    // Smallest number m of the largest children to move out so that the rest fits. The rest
    // shrinks as m grows, so a binary search needs only O(log children) measurements.
    const bySize = [...children].sort((a, b) => rawBytes([b]) - rawBytes([a]));
    const rest = (moved: number) => {
      const out = new Set(bySize.slice(0, moved));
      return [exact, ...children.filter((c) => !out.has(c))];
    };
    let low = 1;
    let high = bySize.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (fits(group.key, rest(mid))) high = mid;
      else low = mid + 1;
    }
    emit(group.key, rest(low));
    const movedOut = new Set(bySize.slice(0, low));
    for (const child of children) if (movedOut.has(child)) visit(child);
  };

  for (const group of childrenOf("", 0, sorted.length)) visit(group);
  plans.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { plans, oversized };
}
