import { describe, expect, it } from "vitest";
import type { UsageResponse } from "../../src/shared/contract";
import { measureUsage } from "../../src/worker/plans";
import { accountIdOf, body, createAppFor, createHarness } from "./harness";

describe("measureUsage", () => {
  it.each([
    [0, 100_000, { percent: 0, status: "ok" }],
    [1_234, 100_000, { percent: 1.2, status: "ok" }],
    [79_999, 100_000, { percent: 79.9, status: "ok" }],
    [80_000, 100_000, { percent: 80, status: "near_limit" }],
    [99_999, 100_000, { percent: 99.9, status: "near_limit" }],
    [100_000, 100_000, { percent: 100, status: "over_limit" }],
    [250_000, 100_000, { percent: 100, status: "over_limit" }],
    [0, 0, { limit: 0, percent: 0, status: "not_included" }],
    [3, 0, { limit: 0, percent: 100, status: "over_limit" }],
    [5, Number.POSITIVE_INFINITY, { limit: null, percent: 0, status: "ok" }],
  ] as const)("%d of %d", (used, limit, expected) => {
    expect(measureUsage("semantic_calls", used, limit)).toMatchObject({ used, ...expected });
  });
});

describe("GET /api/apps/:id/usage", () => {
  async function setup() {
    const h = createHarness();
    const cookie = await h.signIn();
    const appId = await createAppFor(h, cookie);
    const insertFor = (app: string, period: string, metric: string, count: number) =>
      h.db.exec(
        "INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, ?, ?, ?)",
        app,
        period,
        metric,
        count,
      );
    const insert = (period: string, metric: string, count: number) => insertFor(appId, period, metric, count);
    /** An app row of the account, without the API's plan check on the number of apps. */
    const addApp = (id: string, accountId: string) =>
      h.db.exec(
        "INSERT INTO apps (id, account_id, name, created_at) VALUES (?, ?, 'Other app', 0)",
        id,
        accountId,
      );
    const usage = (query = "") => h.call("GET", `/api/apps/${appId}/usage${query}`, { cookie });
    return { h, appId, insert, insertFor, addApp, usage };
  }

  it("reports the current UTC month by default, with zeros for missing metrics", async () => {
    const { appId, insert, usage } = await setup();
    insert("2026-10", "semantic_calls", 85_000);
    insert("2026-09", "semantic_calls", 1);
    insert("2026-10", "image_classifications", 100);

    const response = await usage();
    expect(response.status).toBe(200);
    expect(await body<UsageResponse>(response)).toEqual({
      appId,
      period: "2026-10",
      plan: { id: "free", name: "Free" },
      metrics: [
        {
          metric: "semantic_calls",
          used: 85_000,
          appUsed: 85_000,
          limit: 100_000,
          percent: 85,
          status: "near_limit",
        },
        {
          metric: "image_classifications",
          used: 100,
          appUsed: 100,
          limit: 100,
          percent: 100,
          status: "over_limit",
        },
        { metric: "custom_emoji", used: 0, appUsed: 0, limit: 0, percent: 0, status: "not_included" },
      ],
    });
  });

  it("measures the account's total over all of its apps, with this app's part", async () => {
    const { h, insert, insertFor, addApp, usage } = await setup();
    h.db.exec("UPDATE accounts SET plan = 'pro'");
    addApp("app_sibling", accountIdOf(h, "ada"));
    h.db.exec("INSERT INTO accounts (id, plan, created_at) VALUES ('acc_other', 'pro', 0)");
    addApp("app_stranger", "acc_other");
    insert("2026-10", "semantic_calls", 1_000_000);
    insertFor("app_sibling", "2026-10", "semantic_calls", 1_400_000);
    insertFor("app_sibling", "2026-10", "image_classifications", 10_000);
    insertFor("app_stranger", "2026-10", "semantic_calls", 5_000_000);

    const report = await body<UsageResponse>(await usage());
    expect(report.metrics).toEqual([
      {
        metric: "semantic_calls",
        used: 2_400_000,
        appUsed: 1_000_000,
        limit: 3_000_000,
        percent: 80,
        status: "near_limit",
      },
      {
        metric: "image_classifications",
        used: 10_000,
        appUsed: 0,
        limit: 10_000,
        percent: 100,
        status: "over_limit",
      },
      { metric: "custom_emoji", used: 0, appUsed: 0, limit: 2_000, percent: 0, status: "ok" },
    ]);
  });

  it("reads the requested period and the owning account's plan limits", async () => {
    const { h, insert, usage } = await setup();
    h.db.exec("UPDATE accounts SET plan = 'pro'");
    insert("2026-09", "semantic_calls", 300_000);

    const report = await body<UsageResponse>(await usage("?period=2026-09"));
    expect(report.period).toBe("2026-09");
    expect(report.plan.name).toBe("Pro");
    expect(report.metrics[0]).toMatchObject({ used: 300_000, limit: 3_000_000, percent: 10, status: "ok" });
  });

  it.each([
    ["?period=2026-13", "period must look like 2026-10 (YYYY-MM)."],
    ["?period=26-10", "period must look like 2026-10 (YYYY-MM)."],
    ["?period=2026-11", "period cannot be later than the current period, 2026-10."],
  ])("rejects %s", async (query, message) => {
    const { usage } = await setup();
    const response = await usage(query);
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: { code: "invalid_request", message, field: "period" } });
  });
});
