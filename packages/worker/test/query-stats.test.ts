import { describe, expect, it, vi } from "vitest";
import { QueryStats, type QueryStatsOptions } from "../src/query-stats.ts";
import { createMemoryStore } from "../src/store.ts";
import { executionContext } from "./fixtures.ts";

const OCT_15 = Date.UTC(2026, 9, 15, 12);
const DAY = "2026-10-15";
const EN_GB = { locale: "en", country: "GB" };

function setup(options: QueryStatsOptions = {}, start = OCT_15) {
  const clock = { now: start };
  const store = createMemoryStore();
  const stats = new QueryStats({ store, now: () => clock.now, ...options });
  const ctx = executionContext();
  /** One search as the handler records it: add, then start a flush when one is due. */
  const search = (query: string, resultCount = 3, appId = "app") => {
    stats.add(appId, query, resultCount, EN_GB);
    stats.flushIfDue(ctx);
  };
  return { clock, store, stats, ctx, search };
}

describe("QueryStats", () => {
  it("aggregates searches and misses per app, UTC day and query before writing", async () => {
    const { store, stats } = setup();
    stats.add("app", "ship it", 5, EN_GB);
    stats.add("app", "ship it", 0, EN_GB);
    stats.add("app", "ship it", 2, EN_GB);
    stats.add("app", "zzz", 0, EN_GB);
    stats.add("other", "ship it", 1, EN_GB);
    await stats.flush();
    expect(store.queryCountOf("app", DAY, "ship it")).toEqual({
      appId: "app",
      day: DAY,
      query: "ship it",
      searches: 3,
      misses: 1,
    });
    expect(store.queries.get(`app|${DAY}|en|GB|ship it`)).toEqual({
      appId: "app",
      day: DAY,
      query: "ship it",
      ...EN_GB,
      searches: 3,
      misses: 1,
    });
    expect(store.queryCountOf("app", DAY, "zzz")).toMatchObject({ searches: 1, misses: 1 });
    expect(store.queryCountOf("other", DAY, "ship it")).toMatchObject({ searches: 1, misses: 0 });
  });

  it("flushes the first search of a quiet isolate at once, then batches for 10 s", async () => {
    const { clock, store, ctx, search } = setup();
    const write = vi.spyOn(store, "addQueryCounts");
    search("ship it");
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(1);

    clock.now += 5_000;
    for (let i = 0; i < 10; i++) search(i % 2 ? "ship it" : "party");
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(1);

    clock.now += 5_000;
    search("party", 0);
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).toEqual([
      { appId: "app", day: DAY, query: "party", ...EN_GB, searches: 6, misses: 1 },
      { appId: "app", day: DAY, query: "ship it", ...EN_GB, searches: 5, misses: 0 },
    ]);
    expect(store.queryCountOf("app", DAY, "ship it")?.searches).toBe(6);
  });

  it("flushes as soon as 100 searches are waiting", async () => {
    const { clock, store, ctx, search } = setup();
    const write = vi.spyOn(store, "addQueryCounts");
    search("ship it");
    await ctx.settle();
    clock.now += 1_000;
    for (let i = 0; i < 99; i++) search("ship it");
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(1);
    search("ship it");
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.queryCountOf("app", DAY, "ship it")?.searches).toBe(101);
  });

  it("writes at most one batch of rows per flush and leaves the rest for the next one", async () => {
    const { stats, store } = setup({ maxRowsPerFlush: 2 });
    const write = vi.spyOn(store, "addQueryCounts");
    for (const query of ["a", "b", "c", "d", "e"]) stats.add("app", query, 1, EN_GB);
    await stats.flush();
    expect(write.mock.calls[0]?.[0]).toHaveLength(2);
    expect(stats.pendingSearches).toBe(3);
    await stats.flush();
    await stats.flush();
    expect(write.mock.calls.map(([rows]) => rows.length)).toEqual([2, 2, 1]);
    expect(store.queries.size).toBe(5);
    expect(stats.pendingSearches).toBe(0);
  });

  it("keeps rows pending when a flush fails, and writes them with the next one", async () => {
    const { clock, store, ctx, search } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "addQueryCounts").mockRejectedValueOnce(new Error("D1 busy"));
    search("ship it", 0);
    await ctx.settle();
    expect(store.queries.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("query_stats_flush_failed"));

    clock.now += 10_000;
    search("ship it");
    await ctx.settle();
    expect(store.queryCountOf("app", DAY, "ship it")).toMatchObject({ searches: 2, misses: 1 });
    warn.mockRestore();
  });

  it("starts a new row at UTC midnight", async () => {
    const { clock, store, stats } = setup({}, Date.UTC(2026, 9, 15, 23, 59, 59));
    stats.add("app", "ship it", 1, EN_GB);
    clock.now = Date.UTC(2026, 9, 16, 0, 0, 1);
    stats.add("app", "ship it", 1, EN_GB);
    await stats.flush();
    expect(store.queryCountOf("app", "2026-10-15", "ship it")?.searches).toBe(1);
    expect(store.queryCountOf("app", "2026-10-16", "ship it")?.searches).toBe(1);
  });

  it("stores only the query, capped at 64 characters, and ignores empty queries", async () => {
    const { store, stats } = setup();
    stats.add("app", "", 0, EN_GB);
    stats.add("app", "x".repeat(80), 1, EN_GB);
    await stats.flush();
    expect([...store.queries.values()]).toEqual([
      { appId: "app", day: DAY, query: "x".repeat(64), ...EN_GB, searches: 1, misses: 0 },
    ]);
  });

  it("drops new rows past the pending cap while D1 is down, and says so once", async () => {
    const { store, stats } = setup({ maxPendingRows: 2 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stats.add("app", "a", 1, EN_GB);
    stats.add("app", "b", 1, EN_GB);
    stats.add("app", "c", 1, EN_GB);
    stats.add("app", "a", 1, EN_GB);
    expect(stats.pendingSearches).toBe(3);
    await stats.flush();
    expect([...store.queries.values()].map((r) => [r.query, r.searches])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "query_stats_dropped", searches: 1 }));
    warn.mockRestore();
  });

  it("keeps one row per locale and country of the same query", async () => {
    const { store, stats } = setup();
    stats.add("app", "football", 3, { locale: "en", country: "GB" });
    stats.add("app", "football", 3, { locale: "en", country: "US" });
    stats.add("app", "football", 3, { locale: "en", country: "US" });
    stats.add("app", "football", 0, { locale: "pt", country: "BR" });
    await stats.flush();
    expect(
      [...store.queries.values()].map((r) => [r.locale, r.country, r.searches, r.misses]).sort(),
    ).toEqual([
      ["en", "GB", 1, 0],
      ["en", "US", 2, 0],
      ["pt", "BR", 1, 1],
    ]);
    expect(store.queryCountOf("app", DAY, "football")).toMatchObject({ searches: 4, misses: 1 });
  });

  it("counts nothing without a store", async () => {
    const stats = new QueryStats();
    stats.add("app", "ship it", 1, EN_GB);
    expect(stats.pendingSearches).toBe(0);
    await expect(stats.flush()).resolves.toBeUndefined();
  });
});
