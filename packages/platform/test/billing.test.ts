import { describe, expect, it } from "vitest";
import {
  type BillingState,
  billingIntervalsOf,
  billingLapsed,
  billingOptions,
  DAY_MS,
  expireLapsedBilling,
  findWhopPlan,
  parseWhopPlanIds,
  priceOf,
  purchasableIntervals,
  serializeWhopPlanIds,
  whopPlanIdFor,
} from "../src/billing.js";
import { SqliteD1 } from "./sqlite-d1.js";

const IDS =
  '{"solo":{"month":"plan_SoloM","year":"plan_SoloY"},"pro":{"month":"plan_ProM"},"scale":{"month":"plan_ScaleM"}}';

describe("billing options", () => {
  it("sells every paid plan monthly and Solo also yearly, at the PLANS prices", () => {
    expect(billingOptions()).toEqual([
      { plan: "solo", interval: "month", priceUsd: 5, periodDays: 30 },
      { plan: "solo", interval: "year", priceUsd: 48, periodDays: 365 },
      { plan: "pro", interval: "month", priceUsd: 20, periodDays: 30 },
      { plan: "scale", interval: "month", priceUsd: 100, periodDays: 30 },
    ]);
    expect(billingIntervalsOf("free")).toEqual([]);
    expect(priceOf("pro", "year")).toBeUndefined();
  });
});

describe("WHOP_PLAN_IDS", () => {
  it("parses the map and finds plans both ways", () => {
    const ids = parseWhopPlanIds(IDS);
    expect(ids).not.toBeNull();
    if (!ids) return;
    expect(whopPlanIdFor(ids, "solo", "year")).toBe("plan_SoloY");
    expect(whopPlanIdFor(ids, "free", "month")).toBeUndefined();
    expect(findWhopPlan(ids, "plan_ProM")).toEqual({ plan: "pro", interval: "month" });
    expect(findWhopPlan(ids, "plan_Other")).toBeUndefined();
    expect(purchasableIntervals(ids)).toEqual({ solo: ["month", "year"], pro: ["month"], scale: ["month"] });
  });

  it("treats a missing value as nothing for sale", () => {
    expect(parseWhopPlanIds(undefined)).toEqual({});
    expect(parseWhopPlanIds("  ")).toEqual({});
    expect(purchasableIntervals({})).toEqual({ solo: [], pro: [], scale: [] });
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["an unknown plan", '{"team":{"month":"plan_A"}}'],
    ["the free plan", '{"free":{"month":"plan_A"}}'],
    ["an interval the plan is not sold for", '{"pro":{"year":"plan_A"}}'],
    ["an unknown interval", '{"solo":{"week":"plan_A"}}'],
    ["an id that is not plan_", '{"solo":{"month":"prod_A"}}'],
    ["one id for two plans", '{"solo":{"month":"plan_A"},"pro":{"month":"plan_A"}}'],
  ])("rejects %s", (_, raw) => {
    expect(parseWhopPlanIds(raw)).toBeNull();
  });

  it("serializes in plan and interval order, so the value is stable", () => {
    const ids = parseWhopPlanIds('{"scale":{"month":"plan_C"},"solo":{"year":"plan_B","month":"plan_A"}}');
    expect(ids && serializeWhopPlanIds(ids)).toBe(
      '{"solo":{"month":"plan_A","year":"plan_B"},"scale":{"month":"plan_C"}}',
    );
  });
});

describe("expireLapsedBilling", () => {
  const NOW = Date.UTC(2026, 9, 15);

  function seed(db: SqliteD1) {
    db.sqlite.exec(`INSERT INTO accounts (id, plan, billing_status, billing_grace_until, current_period_end, created_at) VALUES
      ('grace_over', 'pro', 'past_due', ${NOW - 1}, NULL, 0),
      ('grace_left', 'pro', 'past_due', ${NOW + DAY_MS}, NULL, 0),
      ('ended', 'solo', 'canceling', NULL, ${NOW - 2 * DAY_MS}, 0),
      ('ending', 'solo', 'canceling', NULL, ${NOW - DAY_MS / 2}, 0),
      ('paid', 'scale', 'active', NULL, ${NOW - 5 * DAY_MS}, 0)`);
  }

  const plans = (db: SqliteD1) =>
    db.rows<{ id: string; plan: string; billing_status: string }>(
      "SELECT id, plan, billing_status FROM accounts ORDER BY id",
    );

  it("moves an ended grace and a cancelled period that ended a day ago to Free", async () => {
    const db = new SqliteD1();
    seed(db);
    expect(await expireLapsedBilling(db, NOW)).toBe(2);
    expect(plans(db)).toEqual([
      { id: "ended", plan: "free", billing_status: "canceled" },
      { id: "ending", plan: "solo", billing_status: "canceling" },
      { id: "grace_left", plan: "pro", billing_status: "past_due" },
      { id: "grace_over", plan: "free", billing_status: "canceled" },
      // An active subscription waits for Whop's renewal events, whatever the date says.
      { id: "paid", plan: "scale", billing_status: "active" },
    ]);
  });

  it("changes only the named account when one is given", async () => {
    const db = new SqliteD1();
    seed(db);
    expect(await expireLapsedBilling(db, NOW, "ended")).toBe(1);
    expect(plans(db).find((row) => row.id === "grace_over")?.plan).toBe("pro");
  });

  it("billingLapsed applies the same rule in code", () => {
    const db = new SqliteD1();
    seed(db);
    const rows = db.rows<{ id: string } & BillingState>(
      "SELECT id, billing_status, billing_grace_until, current_period_end FROM accounts ORDER BY id",
    );
    expect(rows.filter((row) => billingLapsed(row, NOW)).map((row) => row.id)).toEqual([
      "ended",
      "grace_over",
    ]);
  });
});
