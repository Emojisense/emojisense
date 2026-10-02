import { describe, expect, it } from "vitest";
import {
  type FlushedUsage,
  findThresholdCrossings,
  thresholdCount,
  usageThresholdEventId,
} from "../src/usage-thresholds.js";
import { SqliteD1 } from "./sqlite-d1.js";

const row = (added: number, total: number, limit = 100): FlushedUsage => ({
  appId: "app_1",
  period: "2026-10",
  metric: "semantic_calls",
  added,
  total,
  limit,
});

describe("threshold crossings", () => {
  it("fires 80% and 100% only in the flush that crosses them", () => {
    expect(findThresholdCrossings([row(10, 79)])).toEqual([]);
    expect(findThresholdCrossings([row(10, 80)])).toEqual([
      { appId: "app_1", period: "2026-10", metric: "semantic_calls", threshold: 80, used: 80, limit: 100 },
    ]);
    expect(findThresholdCrossings([row(5, 85)])).toEqual([]);
    expect(findThresholdCrossings([row(20, 100)]).map((c) => c.threshold)).toEqual([100]);
    expect(findThresholdCrossings([row(1, 101)])).toEqual([]);
  });

  it("fires both when one flush jumps over both", () => {
    expect(findThresholdCrossings([row(50, 120)]).map((c) => c.threshold)).toEqual([80, 100]);
  });

  it("rounds the threshold up and skips unlimited or zero limits", () => {
    expect(thresholdCount(7, 80)).toBe(6);
    expect(findThresholdCrossings([row(1, 6, 7)]).map((c) => c.threshold)).toEqual([80]);
    expect(findThresholdCrossings([row(10, 10, 0)])).toEqual([]);
    expect(findThresholdCrossings([row(10, 10, Number.POSITIVE_INFINITY)])).toEqual([]);
  });

  it("derives a stable event id from app, period, metric, threshold and limit", async () => {
    const [crossing] = findThresholdCrossings([row(10, 80)]);
    if (!crossing) throw new Error("expected a crossing");
    const id = await usageThresholdEventId(crossing);
    expect(id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(await usageThresholdEventId({ ...crossing, used: 95 })).toBe(id);
    expect(await usageThresholdEventId({ ...crossing, threshold: 100 })).not.toBe(id);
    expect(await usageThresholdEventId({ ...crossing, period: "2026-11" })).not.toBe(id);
    expect(await usageThresholdEventId({ ...crossing, limit: 200 })).not.toBe(id);
  });
});

describe("dedupe on the real usage_monthly UPSERT", () => {
  /** One isolate's flush: the same statement the API Worker's D1 store runs. */
  async function flush(db: SqliteD1, added: number, limit = 1000): Promise<FlushedUsage> {
    const [result] = (await db.batch([
      db
        .prepare(
          `INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, ?, ?, ?)
           ON CONFLICT (app_id, period, metric) DO UPDATE SET count = count + excluded.count
           RETURNING count`,
        )
        .bind("app_1", "2026-10", "semantic_calls", added),
    ])) as Array<{ results: Array<{ count: number }> }>;
    const total = result?.results[0]?.count ?? 0;
    return { appId: "app_1", period: "2026-10", metric: "semantic_calls", added, total, limit };
  }

  it("emits each threshold exactly once across many interleaved flushes", async () => {
    const db = new SqliteD1();
    db.seedApp();
    const crossings = [];
    // Three "isolates" flushing batches of different sizes, interleaved, up to ≈ 1.5× the limit.
    const batches = Array.from({ length: 200 }, (_, i) => [7, 13, 3][i % 3] ?? 1);
    for (const added of batches) crossings.push(...findThresholdCrossings([await flush(db, added)]));
    expect(crossings.map((c) => c.threshold)).toEqual([80, 100]);
    expect(crossings[0]?.used).toBeGreaterThanOrEqual(800);
    expect(crossings[1]?.used).toBeGreaterThanOrEqual(1000);
  });

  it("starts over in a new period", async () => {
    const db = new SqliteD1();
    db.seedApp();
    expect(findThresholdCrossings([await flush(db, 900)]).map((c) => c.threshold)).toEqual([80]);
    expect(findThresholdCrossings([await flush(db, 100)]).map((c) => c.threshold)).toEqual([100]);
    db.exec("UPDATE usage_monthly SET period = '2026-09'");
    expect(findThresholdCrossings([await flush(db, 950)]).map((c) => c.threshold)).toEqual([80]);
  });
});
