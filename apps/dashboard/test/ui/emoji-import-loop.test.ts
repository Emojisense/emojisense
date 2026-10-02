import { describe, expect, it } from "vitest";
import { addBatch, importAll, importPercent } from "../../src/app/lib/emojiImport";
import type { EmojiImportResponse } from "../../src/shared/contract";

function batch(
  imported: number,
  remaining: number,
  skippedBy: Partial<EmojiImportResponse["skippedBy"]> = {},
) {
  const reasons = { alias: 0, exists: 0, invalid: 0, limit: 0, failed: 0, ...skippedBy };
  const skipped = Object.values(reasons).reduce((sum, n) => sum + n, 0);
  return { imported, skipped, remaining, skippedBy: reasons } satisfies EmojiImportResponse;
}

/** Answers like the API: emoji imported by earlier calls come back as `exists`. */
function fakeApi(answers: EmojiImportResponse[]) {
  const calls: number[] = [];
  return {
    calls,
    importBatch: async () => {
      calls.push(calls.length + 1);
      const answer = answers.shift();
      if (!answer) throw new Error("called once too often");
      return answer;
    },
  };
}

describe("addBatch", () => {
  it("adds imports and keeps only the emoji that existed before the import as exists", () => {
    const first = addBatch(null, batch(50, 62, { exists: 2, alias: 4 }));
    const second = addBatch(first, batch(50, 12, { exists: 52, alias: 4 }));
    expect(second).toEqual({
      imported: 100,
      skippedBy: { alias: 4, exists: 2, invalid: 0, limit: 0, failed: 0 },
      skipped: 6,
      remaining: 12,
    });
    expect(importPercent(second)).toBe(89);
  });
});

describe("importAll", () => {
  it("calls again while emoji remain and reports progress after every batch", async () => {
    const api = fakeApi([batch(50, 62), batch(50, 12, { exists: 50 }), batch(12, 0, { exists: 100 })]);
    const seen: string[] = [];
    const result = await importAll(api.importBatch, {
      onProgress: (progress) => seen.push(`${progress.imported}/${progress.imported + progress.remaining}`),
    });
    expect(api.calls).toHaveLength(3);
    expect(seen).toEqual(["50/112", "100/112", "112/112"]);
    expect(result).toMatchObject({ imported: 112, remaining: 0, skipped: 0 });
  });

  it("stops when a batch imports nothing, so failing downloads cannot loop forever", async () => {
    const api = fakeApi([batch(0, 40, { failed: 50 })]);
    const result = await importAll(api.importBatch);
    expect(api.calls).toHaveLength(1);
    expect(result).toMatchObject({ imported: 0, remaining: 40 });
  });

  it("stops after the call in flight when the signal aborts", async () => {
    const api = fakeApi([batch(50, 62), batch(50, 12)]);
    const controller = new AbortController();
    const result = await importAll(api.importBatch, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    expect(api.calls).toHaveLength(1);
    expect(result.remaining).toBe(62);
  });

  it("continues the total of a run that stopped", async () => {
    const api = fakeApi([batch(12, 0, { exists: 100 })]);
    const from = addBatch(addBatch(null, batch(50, 62)), batch(50, 12, { exists: 50 }));
    const result = await importAll(api.importBatch, { from });
    expect(result).toMatchObject({ imported: 112, remaining: 0, skippedBy: { exists: 0 } });
  });
});
