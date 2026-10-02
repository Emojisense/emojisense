import { DatabaseSync } from "node:sqlite";
import type { D1Like, D1Statement } from "../src/store.ts";

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

/** A fresh in-memory SQLite database with the real migrations and D1's foreign-key enforcement. */
export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations) db.exec(sql);
  return db;
}

type Executable = D1Statement & { runSync(): void };

/** The D1 calls the Worker makes, mapped onto node:sqlite (same SQLite dialect as D1). */
export function sqliteD1(db: DatabaseSync): D1Like {
  const statement = (sql: string, params: unknown[] = []): Executable => ({
    bind: (...values) => statement(sql, values),
    first: async <T>() => (db.prepare(sql).get(...params) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    runSync: () => void db.prepare(sql).run(...params),
  });
  return {
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction.
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        for (const s of statements) (s as Executable).runSync();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
