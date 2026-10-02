import type { DatabaseSync } from "node:sqlite";
import { hashKey } from "@emojisense/platform";
import { beforeEach, describe, expect, it } from "vitest";
import { createD1Store, type Store } from "../src/store.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

describe("D1 store on the platform schema", () => {
  let db: DatabaseSync;
  let store: Store;
  const KEY = "pk_live_storetest000000000000000000";

  beforeEach(async () => {
    db = migratedDatabase();
    db.exec(`
      INSERT INTO accounts (id, email, plan, created_at) VALUES ('acc', 'dev@example.com', 'pro', 0);
      INSERT INTO apps (id, account_id, name, created_at) VALUES ('app_1', 'acc', 'Demo', 0);`);
    db.prepare(
      `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at, revoked_at)
       VALUES (?, 'app_1', ?, ?, ?, ?, 0, ?)`,
    ).run("key_1", "publishable", KEY.slice(0, 12), await hashKey(KEY), '["https://app.example.com"]', null);
    store = createD1Store(sqliteD1(db));
  });

  it("finds a key by hash, with its account's plan and origins", async () => {
    expect(await store.findKeyByHash(await hashKey(KEY))).toEqual({
      id: "key_1",
      appId: "app_1",
      kind: "publishable",
      plan: "pro",
      allowedOrigins: ["https://app.example.com"],
      revoked: false,
    });
    expect(await store.findKeyByHash(await hashKey("pk_live_other"))).toBeUndefined();
  });

  it("reads the plan from the owning account, not the legacy apps.plan column", async () => {
    db.exec("UPDATE apps SET plan = 'free'; UPDATE accounts SET plan = 'scale';");
    expect((await store.findKeyByHash(await hashKey(KEY)))?.plan).toBe("scale");
  });

  it("reports revoked keys and never opens a key with corrupt origins to every origin", async () => {
    db.prepare("UPDATE api_keys SET revoked_at = 1, allowed_origins = 'oops' WHERE id = 'key_1'").run();
    const key = await store.findKeyByHash(await hashKey(KEY));
    expect(key?.revoked).toBe(true);
    expect(key?.allowedOrigins.length).toBeGreaterThan(0);
  });

  it("adds usage with one batched upsert per period and metric", async () => {
    await store.addUsage([
      { appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 3 },
      { appId: "app_1", period: "2026-10", metric: "image_classifications", count: 1 },
    ]);
    await store.addUsage([{ appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 4 }]);
    await store.addUsage([]);
    expect(await store.readUsage("app_1", "2026-10")).toEqual({
      semantic_calls: 7,
      image_classifications: 1,
    });
    expect(await store.readUsage("app_1", "2026-11")).toEqual({});
  });

  it("returns each row's new total after the upsert", async () => {
    await store.addUsage([{ appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 3 }]);
    expect(
      await store.addUsage([
        { appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 4 },
        { appId: "app_1", period: "2026-10", metric: "image_classifications", count: 2 },
      ]),
    ).toEqual([
      { appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 7 },
      { appId: "app_1", period: "2026-10", metric: "image_classifications", count: 2 },
    ]);
    expect(await store.addUsage([])).toEqual([]);
  });

  it("rejects the whole batch when one row breaks a constraint", async () => {
    await expect(
      store.addUsage([
        { appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 1 },
        { appId: "missing_app", period: "2026-10", metric: "semantic_calls", count: 1 },
      ]),
    ).rejects.toThrow();
    expect(await store.readUsage("app_1", "2026-10")).toEqual({});
  });

  it("upserts query counts per app, day and query", async () => {
    const day = "2026-10-15";
    await store.addQueryCounts([
      { appId: "app_1", day, query: "ship it", searches: 3, misses: 0 },
      { appId: "app_1", day, query: "zzz", searches: 2, misses: 2 },
    ]);
    await store.addQueryCounts([
      { appId: "app_1", day, query: "ship it", searches: 1, misses: 1 },
      { appId: "app_1", day: "2026-10-16", query: "ship it", searches: 1, misses: 0 },
    ]);
    await store.addQueryCounts([]);
    expect(db.prepare("SELECT * FROM query_daily ORDER BY day, query").all()).toEqual([
      { app_id: "app_1", day, query: "ship it", searches: 4, misses: 1 },
      { app_id: "app_1", day, query: "zzz", searches: 2, misses: 2 },
      { app_id: "app_1", day: "2026-10-16", query: "ship it", searches: 1, misses: 0 },
    ]);
  });

  it("skips query counts of a deleted app instead of failing the batch", async () => {
    await store.addQueryCounts([
      { appId: "deleted_app", day: "2026-10-15", query: "ship it", searches: 1, misses: 0 },
      { appId: "app_1", day: "2026-10-15", query: "ship it", searches: 1, misses: 0 },
    ]);
    expect(db.prepare("SELECT app_id, searches FROM query_daily").all()).toEqual([
      { app_id: "app_1", searches: 1 },
    ]);
  });
});
