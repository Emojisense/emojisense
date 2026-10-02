/// <reference types="node" />
/**
 * D1 for tests: real SQLite (node:sqlite) with every migration applied, behind D1DatabaseLike.
 * D1 is SQLite too, so constraints, ON CONFLICT and RETURNING behave the same.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { D1DatabaseLike, D1StatementLike, SqlValue } from "../src/d1-like.js";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

export class SqliteD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(MIGRATIONS).sort()) {
      if (file.endsWith(".sql")) this.sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    }
  }

  prepare(sql: string): D1StatementLike {
    return this.#statement(sql, []);
  }

  async batch(statements: D1StatementLike[]): Promise<unknown[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((s) => ({ results: (s as unknown as { rows(): unknown[] }).rows() }));
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  rows<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  exec(sql: string, ...params: SQLInputValue[]): void {
    this.sqlite.prepare(sql).run(...params);
  }

  /** An account on `plan` with one app. */
  seedApp(options: { accountId?: string; appId?: string; plan?: string } = {}) {
    const accountId = options.accountId ?? "acc_1";
    const appId = options.appId ?? "app_1";
    this.sqlite
      .prepare("INSERT OR IGNORE INTO accounts (id, name, plan, created_at) VALUES (?, 'Ada', ?, 0)")
      .run(accountId, options.plan ?? "scale");
    this.sqlite
      .prepare("INSERT INTO apps (id, account_id, name, created_at) VALUES (?, ?, 'Chat', 0)")
      .run(appId, accountId);
    return { accountId, appId };
  }

  #statement(sql: string, params: SqlValue[]): D1StatementLike & { rows(): unknown[] } {
    const db = this.sqlite;
    const statement = {
      bind: (...values: SqlValue[]) => {
        if (values.some((value) => value === undefined)) throw new Error("D1_TYPE_ERROR: undefined");
        return this.#statement(sql, values);
      },
      first: async <T>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null) as T | null,
      all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
      rows: () => db.prepare(sql).all(...params),
    };
    return statement;
  }
}

/** An R2 stand-in that keeps objects in a Map. */
export function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string | undefined }>();
  return {
    objects,
    put: async (
      key: string,
      value: ArrayBuffer | Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      objects.set(key, {
        bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
        contentType: options?.httpMetadata?.contentType,
      });
      return {};
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
}
