/**
 * In-memory D1 for tests: real SQLite (node:sqlite) with the real migrations, behind the
 * D1 interface subset in src/worker/d1.ts. Constraints, ON CONFLICT and RETURNING behave as
 * they do in D1, which is also SQLite.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { D1Database, D1PreparedStatement, D1Result, D1Value } from "../../src/worker/d1";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../packages/platform/migrations", import.meta.url));

class FakeStatement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    // D1 rejects undefined; failing here catches the same bug a deploy would.
    if (values.some((value) => value === undefined))
      throw new Error("D1_TYPE_ERROR: undefined is not supported");
    return new FakeStatement(this.db, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row ? ({ ...row } as T) : null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return {
      results: rows.map((row) => ({ ...row }) as T),
      success: true,
      meta: { changes: 0, last_row_id: 0 },
    };
  }

  async run<T>(): Promise<D1Result<T>> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      results: [],
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }

  runSync(): void {
    this.db.prepare(this.sql).run(...this.params);
  }
}

export class FakeD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
  }

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this.sqlite, query);
  }

  /** D1 runs a batch as one transaction. */
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      for (const statement of statements) (statement as FakeStatement).runSync();
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return statements.map(() => ({ results: [], success: true, meta: { changes: 0, last_row_id: 0 } }));
  }

  /** Test helper: direct reads without going through the API. */
  rows<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  exec(sql: string, ...params: SQLInputValue[]): void {
    this.sqlite.prepare(sql).run(...params);
  }
}
