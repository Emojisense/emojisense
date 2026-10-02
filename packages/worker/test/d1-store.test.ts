import { DatabaseSync } from "node:sqlite";
import { hashKey } from "@emojisense/platform";
import { beforeEach, describe, expect, it } from "vitest";
import { createD1Store, type D1Like, type D1Statement, type Store } from "../src/store.ts";

/** Every migration of the shared schema, in file-name order (what `wrangler d1 migrations apply` runs). */
const migrations = Object.entries(
  import.meta.glob<string>("../../platform/migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

type Executable = D1Statement & { run(): void };

/** The D1 calls the store makes, mapped onto node:sqlite (same SQLite dialect as D1). */
function sqliteD1(db: DatabaseSync): D1Like {
  const statement = (sql: string, params: unknown[] = []): Executable => ({
    bind: (...values) => statement(sql, values),
    first: async <T>() => (db.prepare(sql).get(...params) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: () => void db.prepare(sql).run(...params),
  });
  return {
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction.
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        for (const s of statements) (s as Executable).run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

describe("D1 store on the platform schema", () => {
  let db: DatabaseSync;
  let store: Store;
  const KEY = "pk_live_storetest000000000000000000";

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    for (const sql of migrations) db.exec(sql);
    db.exec(`
      INSERT INTO accounts (id, email, created_at) VALUES ('acc', 'dev@example.com', 0);
      INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_1', 'acc', 'Demo', 'pro', 0);`);
    db.prepare(
      `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at, revoked_at)
       VALUES (?, 'app_1', ?, ?, ?, ?, 0, ?)`,
    ).run("key_1", "publishable", KEY.slice(0, 12), await hashKey(KEY), '["https://app.example.com"]', null);
    store = createD1Store(sqliteD1(db));
  });

  it("finds a key by hash, with its app's plan and origins", async () => {
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

  it("rejects the whole batch when one row breaks a constraint", async () => {
    await expect(
      store.addUsage([
        { appId: "app_1", period: "2026-10", metric: "semantic_calls", count: 1 },
        { appId: "missing_app", period: "2026-10", metric: "semantic_calls", count: 1 },
      ]),
    ).rejects.toThrow();
    expect(await store.readUsage("app_1", "2026-10")).toEqual({});
  });
});
