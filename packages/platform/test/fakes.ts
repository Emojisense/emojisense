import { DatabaseSync } from "node:sqlite";
import type { EmojiBucket, EmojiObject, SqlDatabase, SqlValue, SqlWriteStatement } from "../src/index.js";

/** Every migration, in file-name order (what `wrangler d1 migrations apply` runs). */
const migrations = Object.entries(
  import.meta.glob<string>("../migrations/*.sql", { query: "?raw", import: "default", eager: true }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

/** D1 on node:sqlite with the real schema. D1 is SQLite too, so constraints behave the same. */
export function sqliteDatabase(): SqlDatabase & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations) sqlite.exec(sql);
  const statement = (sql: string, params: SqlValue[] = []): SqlWriteStatement => ({
    bind: (...values) => statement(sql, values),
    first: async <T>() => (sqlite.prepare(sql).get(...params) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
  });
  return { sqlite, prepare: (sql) => statement(sql) };
}

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string | undefined;
  cacheControl: string | undefined;
}

/** R2 in memory. */
export function memoryBucket(): EmojiBucket & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, {
        bytes: value,
        contentType: options?.httpMetadata?.contentType,
        cacheControl: options?.httpMetadata?.cacheControl,
      });
      return {};
    },
    async get(key): Promise<EmojiObject | null> {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: new Blob([object.bytes.slice()]).stream(),
        size: object.bytes.byteLength,
        httpEtag: `"${key}"`,
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
}

const encoder = new TextEncoder();

export const IMAGES = {
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  gif: encoder.encode("GIF89a\u0001\u0000\u0001\u0000"),
  webp: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]),
  svg: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4"/></svg>'),
};

export const svg = (body: string) =>
  encoder.encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">${body}</svg>`);
