import { describe, expect, it } from "vitest";
import { displayPrefix, generateKey, hashKey, keyKind, originAllowed } from "../src/keys.js";
import { getPlan, PLANS, periodOf } from "../src/plans.js";

describe("keys", () => {
  it("generates typed keys and hashes them stably", async () => {
    const key = generateKey("publishable");
    expect(keyKind(key)).toBe("publishable");
    expect(keyKind(generateKey("secret"))).toBe("secret");
    expect(keyKind("nope")).toBeUndefined();
    expect(displayPrefix(key)).toHaveLength(12);
    expect(await hashKey(key)).toBe(await hashKey(key));
    expect(await hashKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("checks origins, with one leading wildcard label", () => {
    const allowed = ["https://app.example.com", "https://*.example.org"];
    expect(originAllowed("https://app.example.com", allowed)).toBe(true);
    expect(originAllowed("https://a.example.org", allowed)).toBe(true);
    expect(originAllowed("https://example.org", allowed)).toBe(false);
    expect(originAllowed("https://evil.com/.example.org", allowed)).toBe(false);
    expect(originAllowed("http://app.example.com", allowed)).toBe(false);
    expect(originAllowed(null, allowed)).toBe(false);
    expect(originAllowed(null, [])).toBe(true);
  });
});

describe("plans", () => {
  it("falls back to free for unknown plans and orders limits by price", () => {
    expect(getPlan("enterprise").id).toBe("free");
    const calls = Object.values(PLANS).map((p) => p.limits.semantic_calls);
    expect([...calls].sort((a, b) => a - b)).toEqual(calls);
  });

  it("uses UTC monthly periods", () => {
    expect(periodOf(Date.UTC(2026, 9, 31, 23, 59))).toBe("2026-10");
  });
});
