import type { DatabaseSync } from "node:sqlite";
import { addDays, dayOf } from "@emojisense/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { handleScheduled, pruneQueryDaily, pruneWaitlist, retentionCutoffs } from "../src/retention.ts";
import type { D1Like } from "../src/store.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

/** The cron's scheduled time: 2026-10-15 03:17 UTC. */
const NOW = Date.UTC(2026, 9, 15, 3, 17);
const TODAY = dayOf(NOW);
const daysAgo = (n: number) => addDays(TODAY, -n);

describe("retentionCutoffs", () => {
  it("keeps today plus N − 1 days, 7 days for plans without analytics", () => {
    expect(retentionCutoffs(NOW)).toEqual({
      byPlan: { free: daysAgo(6), solo: daysAgo(6), pro: daysAgo(29), scale: daysAgo(364) },
      fallback: daysAgo(6),
    });
  });
});

describe("pruneQueryDaily", () => {
  let db: DatabaseSync;
  let d1: D1Like;

  /** One account on `plan` with one app (whose own plan column says "free", to prove it is ignored). */
  const account = (id: string, plan: string) =>
    db.exec(`
      INSERT INTO accounts (id, created_at, plan) VALUES ('${id}', 0, '${plan}');
      INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_${id}', '${id}', 'App', 'free', 0);`);
  const row = (appId: string, day: string, query = "ship it") =>
    db
      .prepare("INSERT INTO query_daily (app_id, day, query, searches, misses) VALUES (?, ?, ?, 1, 0)")
      .run(appId, day, query);
  const remaining = (appId: string) =>
    db
      .prepare("SELECT day FROM query_daily WHERE app_id = ? ORDER BY day")
      .all(appId)
      .map((r) => r.day);

  beforeEach(() => {
    db = migratedDatabase();
    d1 = sqliteD1(db);
  });

  it("deletes each app's rows older than its account plan's retention", async () => {
    for (const [id, plan] of [
      ["free", "free"],
      ["solo", "solo"],
      ["pro", "pro"],
      ["scale", "scale"],
      ["legacy", "enterprise"],
    ]) {
      account(id as string, plan as string);
      for (const n of [0, 6, 7, 29, 30, 364, 365]) row(`app_${id}`, daysAgo(n));
    }

    const result = await pruneQueryDaily(d1, NOW);

    expect(remaining("app_free")).toEqual([daysAgo(6), daysAgo(0)]);
    expect(remaining("app_solo")).toEqual([daysAgo(6), daysAgo(0)]);
    expect(remaining("app_legacy")).toEqual([daysAgo(6), daysAgo(0)]);
    expect(remaining("app_pro")).toEqual([daysAgo(29), daysAgo(7), daysAgo(6), daysAgo(0)]);
    expect(remaining("app_scale")).toEqual([
      daysAgo(364),
      daysAgo(30),
      daysAgo(29),
      daysAgo(7),
      daysAgo(6),
      daysAgo(0),
    ]);
    expect(result).toEqual({ deleted: 3 * 5 + 3 + 1, batches: 1, complete: true });
  });

  it("follows a plan change on the next run", async () => {
    account("acc", "pro");
    row("app_acc", daysAgo(20));
    await pruneQueryDaily(d1, NOW);
    expect(remaining("app_acc")).toEqual([daysAgo(20)]);

    db.exec("UPDATE accounts SET plan = 'free' WHERE id = 'acc'");
    await pruneQueryDaily(d1, NOW);
    expect(remaining("app_acc")).toEqual([]);
  });

  it("deletes in batches and stops at the batch cap, leaving the rest to the next run", async () => {
    account("acc", "free");
    for (let i = 0; i < 5; i++) row("app_acc", daysAgo(10), `query ${i}`);

    expect(await pruneQueryDaily(d1, NOW, { batchSize: 2, maxBatches: 2 })).toEqual({
      deleted: 4,
      batches: 2,
      complete: false,
    });
    expect(await pruneQueryDaily(d1, NOW, { batchSize: 2, maxBatches: 2 })).toEqual({
      deleted: 1,
      batches: 1,
      complete: true,
    });
    expect(remaining("app_acc")).toEqual([]);
  });

  it("does nothing when no row has expired", async () => {
    account("acc", "free");
    row("app_acc", TODAY);
    expect(await pruneQueryDaily(d1, NOW)).toEqual({ deleted: 0, batches: 1, complete: true });
  });
});

describe("pruneWaitlist", () => {
  let db: DatabaseSync;
  let d1: D1Like;

  const join = (email: string, createdAt: number) =>
    db.prepare("INSERT INTO waitlist (email, plan, created_at) VALUES (?, 'pro', ?)").run(email, createdAt);
  const emails = () =>
    db
      .prepare("SELECT email FROM waitlist ORDER BY email")
      .all()
      .map((r) => r.email);

  beforeEach(() => {
    db = migratedDatabase();
    d1 = sqliteD1(db);
  });

  it("deletes rows whose first sign-up is more than 12 months old", async () => {
    const twelveMonthsAgo = Date.UTC(2025, 9, 15, 3, 17);
    join("old@example.com", twelveMonthsAgo - 1);
    join("edge@example.com", twelveMonthsAgo);
    join("new@example.com", NOW - 86_400_000);

    expect(await pruneWaitlist(d1, NOW)).toEqual({ deleted: 1, batches: 1, complete: true });
    expect(emails()).toEqual(["edge@example.com", "new@example.com"]);
  });

  it("deletes in batches and stops at the batch cap", async () => {
    for (let i = 0; i < 5; i++) join(`p${i}@example.com`, 0);
    expect(await pruneWaitlist(d1, NOW, { batchSize: 2, maxBatches: 2 })).toEqual({
      deleted: 4,
      batches: 2,
      complete: false,
    });
    expect(await pruneWaitlist(d1, NOW, { batchSize: 2, maxBatches: 2 })).toEqual({
      deleted: 1,
      batches: 1,
      complete: true,
    });
    expect(emails()).toEqual([]);
  });
});

describe("handleScheduled", () => {
  it("builds the regional trends, prunes query_daily, the waitlist and trends_daily, and logs counts only", async () => {
    const db = migratedDatabase();
    db.exec(`
      INSERT INTO accounts (id, created_at) VALUES ('acc', 0);
      INSERT INTO apps (id, account_id, name, created_at) VALUES ('app_acc', 'acc', 'App', 0);
      INSERT INTO query_daily (app_id, day, query, searches, misses) VALUES ('app_acc', '2026-01-01', 'secret', 1, 0);
      INSERT INTO waitlist (email, plan, created_at) VALUES ('ada@example.com', 'pro', 0);`);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleScheduled({ DB: sqliteD1(db) as unknown as D1Database }, NOW);
    expect(log.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "trends_daily_built",
          day: TODAY,
          candidates: 0,
          privacyDropped: 0,
          capped: 0,
          rows: 0,
          rising: 0,
          regions: 0,
        }),
      ],
      [JSON.stringify({ event: "query_daily_pruned", deleted: 1, batches: 1, complete: true })],
      [JSON.stringify({ event: "waitlist_pruned", deleted: 1, batches: 1, complete: true })],
      [JSON.stringify({ event: "trends_daily_pruned", deleted: 0, batches: 1, complete: true })],
    ]);
    log.mockRestore();
  });

  it("runs every job, then rethrows the first failure so the cron run is marked as failed", async () => {
    const db = migratedDatabase();
    db.exec("INSERT INTO waitlist (email, plan, created_at) VALUES ('ada@example.com', 'pro', 0)");
    const d1 = sqliteD1(db);
    const env = {
      DB: {
        ...d1,
        prepare: (sql: string) => {
          if (sql.includes("query_daily")) throw new TypeError("D1 down");
          return d1.prepare(sql);
        },
      },
    } as unknown as Env;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleScheduled(env, NOW)).rejects.toThrow("D1 down");
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "trends_daily_failed", error: "TypeError" }));
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: "query_daily_prune_failed", error: "TypeError" }),
    );
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "waitlist_pruned", deleted: 1, batches: 1, complete: true }),
    );
    error.mockRestore();
    log.mockRestore();
  });

  it("does nothing without a database", async () => {
    await expect(handleScheduled({}, NOW)).resolves.toBeUndefined();
  });
});
