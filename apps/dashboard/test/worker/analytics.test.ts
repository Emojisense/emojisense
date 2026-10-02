import { describe, expect, it } from "vitest";
import type { AnalyticsResponse } from "../../src/shared/contract";
import { TOP_QUERIES } from "../../src/worker/routes/analytics";
import { body, createAppFor, createHarness, NOW } from "./harness";

/** 2026-10-15, the harness clock's UTC day. */
const TODAY = new Date(NOW).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

async function setup(plan = "pro") {
  const h = createHarness();
  const cookie = await h.signIn();
  const appId = await createAppFor(h, cookie);
  const [owner] = h.db.rows<{ account_id: string }>("SELECT account_id FROM apps WHERE id = ?", appId);
  h.db.exec("UPDATE accounts SET plan = ? WHERE id = ?", plan, owner?.account_id ?? "");
  const insert = (day: string, query: string, searches: number, misses = 0, app = appId) =>
    h.db.exec(
      "INSERT INTO query_daily (app_id, day, query, searches, misses) VALUES (?, ?, ?, ?, ?)",
      app,
      day,
      query,
      searches,
      misses,
    );
  const analytics = (query = "", as = cookie) =>
    h.call("GET", `/api/apps/${appId}/analytics${query}`, { cookie: as });
  return { h, cookie, appId, insert, analytics };
}

describe("GET /api/apps/:id/analytics", () => {
  it("returns every day of the window, oldest first, with zeros for days without searches", async () => {
    const { insert, analytics } = await setup();
    insert(TODAY, "ship it", 4, 1);
    insert(TODAY, "zzz", 2, 2);
    insert(daysAgo(2), "ship it", 3);
    insert(daysAgo(7), "ship it", 9); // outside a 7-day window

    const response = await analytics("?days=7");
    expect(response.status).toBe(200);
    const report = await body<AnalyticsResponse>(response);
    expect(report.days).toEqual([
      { day: daysAgo(6), searches: 0, misses: 0 },
      { day: daysAgo(5), searches: 0, misses: 0 },
      { day: daysAgo(4), searches: 0, misses: 0 },
      { day: daysAgo(3), searches: 0, misses: 0 },
      { day: daysAgo(2), searches: 3, misses: 0 },
      { day: daysAgo(1), searches: 0, misses: 0 },
      { day: TODAY, searches: 6, misses: 3 },
    ]);
  });

  it("ranks top queries and misses over the window, naming only queries seen at least 5 times", async () => {
    const { insert, analytics } = await setup();
    insert(TODAY, "ship it", 4);
    insert(daysAgo(1), "ship it", 4, 1);
    insert(TODAY, "party", 6, 0);
    insert(TODAY, "lgtm", 5, 3);
    insert(TODAY, "my secret name", 4, 4);
    insert(daysAgo(40), "old", 50, 50);

    const report = await body<AnalyticsResponse>(await analytics("?days=30"));
    expect(report.topQueries).toEqual([
      { query: "ship it", searches: 8 },
      { query: "party", searches: 6 },
      { query: "lgtm", searches: 5 },
    ]);
    expect(report.topMisses).toEqual([
      { query: "lgtm", misses: 3 },
      { query: "ship it", misses: 1 },
    ]);
    // The rare query still counts in the day totals.
    expect(report.days.at(-1)).toEqual({ day: TODAY, searches: 19, misses: 7 });
  });

  it(`lists at most ${TOP_QUERIES} queries, ties in alphabetical order`, async () => {
    const { insert, analytics } = await setup();
    for (let i = 0; i < TOP_QUERIES + 5; i++) insert(TODAY, `query ${String(i).padStart(2, "0")}`, 5, 5);
    const report = await body<AnalyticsResponse>(await analytics());
    expect(report.topQueries).toHaveLength(TOP_QUERIES);
    expect(report.topMisses).toHaveLength(TOP_QUERIES);
    expect(report.topQueries[0]?.query).toBe("query 00");
  });

  it("defaults to 30 days and cuts a longer window to the plan's retention", async () => {
    const { analytics } = await setup("pro");
    expect((await body<AnalyticsResponse>(await analytics())).days).toHaveLength(30);
    const capped = await body<AnalyticsResponse>(await analytics("?days=90"));
    expect(capped.days).toHaveLength(30);
    expect(capped.days[0]?.day).toBe(daysAgo(29));
  });

  it("shows 90 days on Scale", async () => {
    const { analytics } = await setup("scale");
    const report = await body<AnalyticsResponse>(await analytics("?days=90"));
    expect(report.days).toHaveLength(90);
    expect(report.days[0]?.day).toBe(daysAgo(89));
  });

  it("counts only this app's rows", async () => {
    const { h, appId, insert, analytics } = await setup();
    h.db.exec(
      "INSERT INTO apps (id, account_id, name, created_at) SELECT 'app_other', account_id, 'Other', 0 FROM apps WHERE id = ?",
      appId,
    );
    insert(TODAY, "ship it", 7, 0, "app_other");
    const report = await body<AnalyticsResponse>(await analytics("?days=7"));
    expect(report.days.at(-1)).toEqual({ day: TODAY, searches: 0, misses: 0 });
    expect(report.topQueries).toEqual([]);
  });

  it.each(["free", "solo"])("answers 402 plan_required with the lowest plan on %s", async (plan) => {
    const { insert, analytics } = await setup(plan);
    insert(TODAY, "ship it", 9);
    const response = await analytics("?days=7");
    expect(response.status).toBe(402);
    expect(await body(response)).toEqual({
      error: "plan_required",
      plan: "pro",
      message: "Search analytics are part of the Pro plan and above.",
    });
  });

  it("reads the plan from the owner's account, not from the app row", async () => {
    const { h, appId, analytics } = await setup("free");
    h.db.exec("UPDATE apps SET plan = 'scale' WHERE id = ?", appId);
    expect((await analytics()).status).toBe(402);
  });

  it.each(["?days=14", "?days=abc", "?days=0x7", "?days=7.0"])("rejects %s", async (query) => {
    const { analytics } = await setup();
    const response = await analytics(query);
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: { code: "invalid_request", message: "days must be one of: 7, 30, 90.", field: "days" },
    });
  });

  it("needs a session and hides other accounts' apps", async () => {
    const { h, appId, analytics } = await setup();
    expect((await h.call("GET", `/api/apps/${appId}/analytics`)).status).toBe(401);
    const bob = await h.signIn("bob");
    const response = await analytics("", bob);
    expect(response.status).toBe(404);
    expect((await h.call("GET", "/api/apps/missing/analytics", { cookie: bob })).status).toBe(404);
  });
});
