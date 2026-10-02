import type { DatabaseSync } from "node:sqlite";
import { addDays, dayOf } from "@emojisense/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleScheduled, pruneTrendsDaily } from "../src/retention.ts";
import type { D1Like } from "../src/store.ts";
import { buildRegionalTrends, readRegionalTrends, trendScore, trendWindows } from "../src/trends.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

/** The cron's scheduled time: 2026-10-15 03:17 UTC. */
const NOW = Date.UTC(2026, 9, 15, 3, 17);
const TODAY = dayOf(NOW);
const daysAgo = (n: number) => addDays(TODAY, -n);

let db: DatabaseSync;
let d1: D1Like;

/** Accounts acc1…accN on `plan`, each with one app app1…appN. */
function accounts(n: number, plan = "scale") {
  for (let i = 1; i <= n; i++) {
    db.exec(`INSERT INTO accounts (id, created_at, plan) VALUES ('acc${i}', 0, '${plan}');
             INSERT INTO apps (id, account_id, name, created_at) VALUES ('app${i}', 'acc${i}', 'App', 0);`);
  }
}

function searched(
  app: string,
  query: string,
  searches: number,
  where: { locale?: string; country?: string; day?: string } = {},
) {
  db.prepare(
    `INSERT INTO query_daily (app_id, day, query, locale, country, searches, misses) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (app_id, day, query, locale, country) DO UPDATE SET searches = searches + excluded.searches`,
  ).run(app, where.day ?? daysAgo(1), query, where.locale ?? "en", where.country ?? "GB", searches);
}

/** The same query from apps 1…n, `each` searches per app. */
function popular(query: string, n: number, each: number, where: Parameters<typeof searched>[3] = {}) {
  for (let i = 1; i <= n; i++) searched(`app${i}`, query, each, where);
}

const stored = () =>
  db
    .prepare(
      "SELECT locale, country, query, score, searches, accounts FROM trends_daily ORDER BY locale, country, query",
    )
    .all();

beforeEach(() => {
  db = migratedDatabase();
  d1 = sqliteD1(db);
});

describe("trend windows and score", () => {
  it("compares the last 7 complete days with the 28 before, and remembers 4 earlier runs", () => {
    expect(trendWindows(NOW)).toEqual({
      day: "2026-10-15",
      recent: { from: "2026-10-08", to: "2026-10-14" },
      baseline: { from: "2026-09-10", to: "2026-10-07" },
      history: ["2026-10-08", "2026-10-01", "2026-09-24", "2026-09-17"],
    });
  });

  it("scores the change in searches per day, smoothed by one search a day", () => {
    expect(trendScore(10, 0)).toBe(2.43);
    expect(trendScore(70, 0)).toBe(11);
    expect(trendScore(70, 280)).toBe(1);
    expect(trendScore(7, 280)).toBe(0.18);
  });
});

describe("buildRegionalTrends", () => {
  it("writes a row per locale and country only with apps of 3 accounts and 10 searches there", async () => {
    accounts(4);
    popular("world cup", 3, 4, { country: "BR", locale: "pt" });
    popular("copa", 2, 10, { country: "BR", locale: "pt" });
    searched("app3", "copa", 10, { country: "PT", locale: "pt" });
    popular("halloween", 3, 3, { country: "US" });
    // Unknown countries count for the locale-wide row only; legacy rows without a locale never.
    popular("pumpkin", 3, 4, { country: "XX" });
    popular("old", 4, 10, { locale: "und", country: "XX" });

    const report = await buildRegionalTrends(d1, NOW);

    expect(stored()).toEqual([
      { locale: "en", country: "*", query: "pumpkin", score: 2.71, searches: 12, accounts: 3 },
      { locale: "pt", country: "*", query: "copa", score: 5.29, searches: 30, accounts: 3 },
      { locale: "pt", country: "*", query: "world cup", score: 2.71, searches: 12, accounts: 3 },
      { locale: "pt", country: "BR", query: "world cup", score: 2.71, searches: 12, accounts: 3 },
    ]);
    expect(report).toEqual({
      day: TODAY,
      candidates: 4,
      privacyDropped: 0,
      capped: 0,
      rows: 4,
      rising: 4,
      regions: 3,
    });
  });

  it("never writes text that may point to a person, nor text the SDK would not send", async () => {
    accounts(3);
    for (const query of ["call 5551234567", "jane1987", "jane doe gmail com", "Ship It"]) {
      popular(query, 3, 5);
    }
    popular("ship it", 3, 5);
    const report = await buildRegionalTrends(d1, NOW);
    expect(stored().map((r) => r.query)).toEqual(["ship it", "ship it"]);
    expect(report.privacyDropped).toBe(8);
  });

  it("reads only the last 7 complete days", async () => {
    accounts(3);
    popular("today", 3, 10, { day: TODAY });
    popular("eight days ago", 3, 10, { day: daysAgo(8) });
    popular("seven days ago", 3, 10, { day: daysAgo(7) });
    await buildRegionalTrends(d1, NOW);
    expect([...new Set(stored().map((r) => r.query))]).toEqual(["seven days ago"]);
  });

  it("takes the larger of the logged and the remembered baseline", async () => {
    accounts(3);
    // Steady: 10 a day per app for 35 days, still in query_daily (Scale keeps a year).
    for (let n = 1; n <= 35; n++) popular("good morning", 3, 10, { day: daysAgo(n) });
    // Gone from query_daily (a 7-day plan), but earlier runs remember 210 searches a week.
    popular("good night", 3, 70);
    for (const day of trendWindows(NOW).history) {
      db.prepare(
        "INSERT INTO trends_daily VALUES (?, 'en', 'GB', 'good night', 1, 210, 3), (?, 'en', '*', 'good night', 1, 210, 3)",
      ).run(day, day);
    }
    // New this week.
    popular("eclipse", 3, 70);

    await buildRegionalTrends(d1, NOW);
    const scores = Object.fromEntries(
      stored()
        .filter((r) => r.country === "GB")
        .map((r) => [r.query, r.score]),
    );
    expect(scores).toEqual({ "good morning": 1, "good night": 1, eclipse: 31 });
  });

  it("keeps the most searched rows per locale and country, then stops at the total cap", async () => {
    accounts(3);
    for (let i = 0; i < 5; i++) popular(`query ${i}`, 3, 4 + i, { country: "DE", locale: "de" });
    const report = await buildRegionalTrends(d1, NOW, { maxRowsPerRegion: 2, maxRows: 3 });
    expect(stored().map((r) => [r.country, r.query])).toEqual([
      ["*", "query 3"],
      ["*", "query 4"],
      ["DE", "query 4"],
    ]);
    expect(report).toMatchObject({ candidates: 10, capped: 7, rows: 3 });
  });

  it("replaces the rows of a run of the same day", async () => {
    accounts(3);
    popular("ship it", 3, 5);
    await buildRegionalTrends(d1, NOW);
    db.exec("DELETE FROM query_daily");
    popular("party", 3, 5);
    await buildRegionalTrends(d1, NOW + 3_600_000);
    expect([...new Set(stored().map((r) => r.query))]).toEqual(["party"]);
  });
});

describe("readRegionalTrends", () => {
  const trend = (day: string, locale: string, country: string, query: string, score: number) =>
    db
      .prepare("INSERT INTO trends_daily VALUES (?, ?, ?, ?, ?, 20, 3)")
      .run(day, locale, country, query, score);

  it("reads the newest day's rising rows, highest score first", async () => {
    trend(daysAgo(1), "pt", "BR", "carnaval", 9);
    trend(TODAY, "pt", "BR", "copa", 4);
    trend(TODAY, "pt", "BR", "bom dia", 1);
    trend(TODAY, "pt", "*", "copa", 3);
    trend(TODAY, "en", "US", "halloween", 6);

    expect((await readRegionalTrends(d1)).map((r) => [r.locale, r.country, r.query])).toEqual([
      ["en", "US", "halloween"],
      ["pt", "BR", "copa"],
      ["pt", "*", "copa"],
    ]);
    expect(await readRegionalTrends(d1, { locale: "pt", country: "BR", minScore: 0 })).toEqual([
      { day: TODAY, locale: "pt", country: "BR", query: "copa", score: 4, searches: 20, accounts: 3 },
      { day: TODAY, locale: "pt", country: "BR", query: "bom dia", score: 1, searches: 20, accounts: 3 },
    ]);
    expect((await readRegionalTrends(d1, { day: daysAgo(1) })).map((r) => r.query)).toEqual(["carnaval"]);
    expect(await readRegionalTrends(d1, { limit: 1 })).toHaveLength(1);
  });
});

describe("trends_daily retention", () => {
  it("keeps today and the 89 days before it", async () => {
    for (const n of [0, 89, 90, 400]) {
      db.prepare("INSERT INTO trends_daily VALUES (?, 'en', 'GB', 'q', 1, 10, 3)").run(daysAgo(n));
    }
    expect(await pruneTrendsDaily(d1, NOW)).toEqual({ deleted: 2, batches: 1, complete: true });
    expect(
      db
        .prepare("SELECT day FROM trends_daily ORDER BY day")
        .all()
        .map((r) => r.day),
    ).toEqual([daysAgo(89), daysAgo(0)]);
  });

  it("builds the trends in the daily cron before the prune deletes the oldest day of a 7-day plan", async () => {
    accounts(3, "free");
    popular("world cup", 3, 4, { day: daysAgo(7) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleScheduled({ DB: d1 as unknown as D1Database }, NOW);
    expect(stored()).toHaveLength(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM query_daily").get()).toEqual({ n: 0 });
    expect(log.mock.calls[0]?.[0]).toBe(
      JSON.stringify({
        event: "trends_daily_built",
        day: TODAY,
        candidates: 2,
        privacyDropped: 0,
        capped: 0,
        rows: 2,
        rising: 2,
        regions: 2,
      }),
    );
    log.mockRestore();
  });
});
