import { describe, expect, it } from "vitest";
import {
  parseWaitlistStatus,
  WAITLIST_KEEP_MONTHS,
  waitlistCutoff,
  waitlistReturnUrl,
} from "../src/waitlist.js";

describe("waitlistCutoff", () => {
  it("is the same UTC instant 12 months earlier", () => {
    expect(WAITLIST_KEEP_MONTHS).toBe(12);
    expect(waitlistCutoff(Date.UTC(2026, 9, 15, 3, 17))).toBe(Date.UTC(2025, 9, 15, 3, 17));
  });

  it("moves a leap day to the next day of the shorter year", () => {
    expect(waitlistCutoff(Date.UTC(2028, 1, 29))).toBe(Date.UTC(2027, 2, 1));
  });
});

describe("waitlistReturnUrl", () => {
  it("points at the waitlist page with the status and the anchor of its message", () => {
    expect(waitlistReturnUrl("https://emojisense.com", "ok")).toBe(
      "https://emojisense.com/waitlist/?status=ok#waitlist-joined",
    );
    expect(waitlistReturnUrl("http://localhost:4321", "error")).toBe(
      "http://localhost:4321/waitlist/?status=error#waitlist-failed",
    );
  });
});

describe("parseWaitlistStatus", () => {
  it("accepts ok and error only", () => {
    expect(parseWaitlistStatus("ok")).toBe("ok");
    expect(parseWaitlistStatus("error")).toBe("error");
    expect(parseWaitlistStatus("OK")).toBeUndefined();
    expect(parseWaitlistStatus("")).toBeUndefined();
    expect(parseWaitlistStatus(null)).toBeUndefined();
  });
});
