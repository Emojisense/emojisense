import type { EmojiImportResponse, EmojiImportSkipReason } from "../api";

/** The running total of a Slack or Discord import, which takes one call per batch of 50. */
export interface ImportProgress {
  imported: number;
  /** Over the whole import. `exists` counts only emoji that were there before it started. */
  skippedBy: Record<EmojiImportSkipReason, number>;
  skipped: number;
  /** New emoji that fit the plan and wait for the next call. */
  remaining: number;
}

/**
 * Adds one call's answer to the total. Every call reports the skips of the whole listing again,
 * and counts the emoji that earlier calls imported as `exists`, so those are taken out.
 */
export function addBatch(total: ImportProgress | null, batch: EmojiImportResponse): ImportProgress {
  const before = total?.imported ?? 0;
  const skippedBy = { ...batch.skippedBy, exists: Math.max(0, batch.skippedBy.exists - before) };
  return {
    imported: before + batch.imported,
    skippedBy,
    skipped: Object.values(skippedBy).reduce((sum, count) => sum + count, 0),
    remaining: batch.remaining,
  };
}

/**
 * Calls `importBatch` while the API says emoji remain. It stops early when `signal` aborts, or
 * when a call imports nothing: the same downloads would fail again, so another call cannot help.
 * `from` continues the total of an import that stopped.
 */
export async function importAll(
  importBatch: () => Promise<EmojiImportResponse>,
  options: {
    from?: ImportProgress | null;
    signal?: AbortSignal;
    onProgress?: (progress: ImportProgress) => void;
  } = {},
): Promise<ImportProgress> {
  let progress = options.from ?? null;
  for (;;) {
    const batch = await importBatch();
    progress = addBatch(progress, batch);
    options.onProgress?.(progress);
    if (batch.remaining === 0 || batch.imported === 0 || options.signal?.aborted) return progress;
  }
}

/** Share of the import that is done, 0–100: imported against imported plus waiting. */
export function importPercent(progress: ImportProgress): number {
  const total = progress.imported + progress.remaining;
  return total === 0 ? 100 : Math.floor((progress.imported / total) * 100);
}
