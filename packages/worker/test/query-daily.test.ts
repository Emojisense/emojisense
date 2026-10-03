import type { DatabaseSync } from "node:sqlite";
import { QUERY_DAYS } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import { migratedDatabase } from "./sqlite-d1.ts";

/** What SQLite will do for `sql`: one line per step of its query plan. */
const plan = (db: DatabaseSync, sql: string, ...params: string[]) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map((r) => r.detail)
    .join("\n");

/**
 * query_daily is written for every keyed search, so its layout is its cost (migration 0009,
 * DECISIONS.md "query_daily: one write per new row"): no index to keep up besides the key, and
 * every reader seeks the key instead of scanning the table.
 */
describe("query_daily layout", () => {
  const db = migratedDatabase();

  it("is its key: no rowid and no other index, so a new row is one written row", () => {
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'query_daily'").get() as {
      sql: string;
    };
    expect(sql).toMatch(/PRIMARY KEY \(day, app_id, query, locale, country\)\s*\)\s*WITHOUT ROWID/);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'query_daily'").all(),
    ).toEqual([]);
  });

  it("reads a day window from the start of the key: the shard build, trends and retention", () => {
    const window = plan(
      db,
      "SELECT q.query, SUM(q.searches) FROM query_daily q JOIN apps a ON a.id = q.app_id WHERE q.day BETWEEN ? AND ? GROUP BY q.query",
      "2026-10-01",
      "2026-10-06",
    );
    expect(window).toMatch(/SEARCH q USING PRIMARY KEY \(day>\? AND day<\?\)/);
    expect(window).not.toMatch(/SCAN q\b/);
  });

  it("seeks one app's rows day by day for the dashboard and account deletion", () => {
    const app = plan(
      db,
      `WITH RECURSIVE ${QUERY_DAYS}
       SELECT q.day, SUM(q.searches) FROM days JOIN query_daily q ON q.day = days.day AND q.app_id = ? GROUP BY q.day`,
      "2026-09-01",
      "2026-10-01",
      "app_a",
    );
    expect(app).toMatch(/SEARCH q USING PRIMARY KEY \(day=\? AND app_id=\?\)/);
    expect(app).not.toMatch(/SCAN q\b/);
  });
});
