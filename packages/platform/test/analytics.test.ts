import { describe, expect, it } from "vitest";
import { addDays, analyticsKeepDays, dayOf, lowestPlanWithAnalytics } from "../src/analytics.js";
import { PLANS } from "../src/plans.js";

describe("analytics", () => {
  it("uses UTC days", () => {
    expect(dayOf(Date.UTC(2026, 9, 15, 23, 59, 59))).toBe("2026-10-15");
    expect(dayOf(Date.UTC(2026, 9, 16))).toBe("2026-10-16");
  });

  it("moves days across month and year ends", () => {
    expect(addDays("2026-10-15", -29)).toBe("2026-09-16");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("keeps rows of plans without analytics for 7 days and caps retention at 365", () => {
    expect(analyticsKeepDays(PLANS.free)).toBe(7);
    expect(analyticsKeepDays(PLANS.solo)).toBe(7);
    expect(analyticsKeepDays(PLANS.pro)).toBe(30);
    expect(analyticsKeepDays(PLANS.scale)).toBe(365);
    expect(analyticsKeepDays({ ...PLANS.scale, analyticsRetentionDays: 1000 })).toBe(365);
  });

  it("names Pro as the lowest plan with analytics", () => {
    expect(lowestPlanWithAnalytics()).toBe("pro");
  });
});
