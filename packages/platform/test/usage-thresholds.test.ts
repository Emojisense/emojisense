import { describe, expect, it } from "vitest";
import {
  type FlushedUsage,
  findThresholdCrossings,
  thresholdCount,
  usageThresholdEventId,
} from "../src/usage-thresholds.js";
import { SqliteD1 } from "./sqlite-d1.js";

const row = (added: number, total: number, limit = 100): FlushedUsage => ({
  accountId: "acc_1",
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
      {
        accountId: "acc_1",
        period: "2026-10",
        metric: "semantic_calls",
        threshold: 80,
        used: 80,
        limit: 100,
      },
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

  it("derives a stable event id from account, period, metric, threshold and limit", async () => {
    const [crossing] = findThresholdCrossings([row(10, 80)]);
    if (!crossing) throw new Error("expected a crossing");
    const id = await usageThresholdEventId(crossing);
    expect(id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(await usageThresholdEventId({ ...crossing, used: 95 })).toBe(id);
    expect(await usageThresholdEventId({ ...crossing, accountId: "acc_2" })).not.toBe(id);
    expect(await usageThresholdEventId({ ...crossing, threshold: 100 })).not.toBe(id);
    expect(await usageThresholdEventId({ ...crossing, period: "2026-11" })).not.toBe(id);
    expect(await usageThresholdEventId({ ...crossing, limit: 200 })).not.toBe(id);
  });
});

describe("dedupe on the real usage_monthly rows, summed per account", () => {
  /**
   * One isolate's flush for one app, as the API Worker's D1 store runs it: the upsert and the read
   * of the account total in one batch (one transaction).
   */
  async function flush(db: SqliteD1, appId: string, added: number, limit = 1000): Promise<FlushedUsage> {
    const results = (await db.batch([
      db
        .prepare(
          `INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, '2026-10', 'semantic_calls', ?)
           ON CONFLICT (app_id, period, metric) DO UPDATE SET count = count + excluded.count`,
        )
        .bind(appId, added),
      db
        .prepare(
          `SELECT SUM(u.count) AS total FROM apps a JOIN usage_monthly u ON u.app_id = a.id
           WHERE a.account_id = (SELECT account_id FROM apps WHERE id = ?)
             AND u.period = '2026-10' AND u.metric = 'semantic_calls'`,
        )
        .bind(appId),
    ])) as Array<{ results: Array<{ total: number }> }>;
    const total = results[1]?.results[0]?.total ?? 0;
    return { accountId: "acc_1", period: "2026-10", metric: "semantic_calls", added, total, limit };
  }

  function twoApps() {
    const db = new SqliteD1();
    db.seedApp({ appId: "app_1" });
    db.seedApp({ appId: "app_2" });
    return db;
  }

  it("emits each threshold exactly once while several apps of the account flush in turn", async () => {
    const db = twoApps();
    const crossings = [];
    // Two apps and three "isolates" with different batch sizes, interleaved, to ≈ 1.5× the limit.
    for (let i = 0; i < 200; i++) {
      const added = [7, 13, 3][i % 3] ?? 1;
      crossings.push(...findThresholdCrossings([await flush(db, i % 2 ? "app_2" : "app_1", added)]));
    }
    expect(crossings.map((c) => c.threshold)).toEqual([80, 100]);
    expect(crossings[0]?.used).toBeGreaterThanOrEqual(800);
    expect(crossings[1]?.used).toBeGreaterThanOrEqual(1000);
  });

  it("counts the other apps of the account, and starts over in a new period", async () => {
    const db = twoApps();
    expect(findThresholdCrossings([await flush(db, "app_1", 700)])).toEqual([]);
    expect(findThresholdCrossings([await flush(db, "app_2", 100)]).map((c) => c.threshold)).toEqual([80]);
    expect(findThresholdCrossings([await flush(db, "app_1", 200)]).map((c) => c.threshold)).toEqual([100]);
    db.exec("UPDATE usage_monthly SET period = '2026-09'");
    expect(findThresholdCrossings([await flush(db, "app_2", 950)]).map((c) => c.threshold)).toEqual([80]);
  });
});
