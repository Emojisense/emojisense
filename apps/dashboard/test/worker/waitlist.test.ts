import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/contract";
import { BASE, body, createHarness, NOW, WEBSITE } from "./harness";

const join = (h: ReturnType<typeof createHarness>, payload: unknown, origin: string | null = WEBSITE) =>
  h.call("POST", "/api/waitlist", { body: payload, origin });

describe("POST /api/waitlist", () => {
  it("stores a normalized email and is idempotent", async () => {
    const h = createHarness();
    const first = await join(h, { email: " Ada@Example.com ", plan: "pro" });
    expect(first.status).toBe(200);
    expect(await body(first)).toEqual({ ok: true, plan: "pro" });

    h.clock.now = NOW + 60_000;
    const again = await join(h, { email: "ada@example.com", plan: "scale" });
    expect(again.status).toBe(200);
    expect(h.db.rows("SELECT * FROM waitlist")).toEqual([
      { email: "ada@example.com", plan: "scale", created_at: NOW },
    ]);
  });

  it("defaults the plan to pro", async () => {
    const h = createHarness();
    expect(await body(await join(h, { email: "a@example.com" }))).toEqual({ ok: true, plan: "pro" });
  });

  it.each([
    [{}, "email"],
    [{ email: "not-an-email" }, "email"],
    [{ email: "a@b" }, "email"],
    [{ email: `${"a".repeat(250)}@example.com` }, "email"],
    [{ email: "a@example.com", plan: "free" }, "plan"],
  ])("rejects %j", async (payload, field) => {
    const h = createHarness();
    const response = await join(h, payload);
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field } });
    expect(response.headers.get("access-control-allow-origin")).toBe(WEBSITE);
  });

  it("needs no session and works from the dashboard itself", async () => {
    const h = createHarness();
    const response = await join(h, { email: "a@example.com" }, BASE);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("shows on /api/me for the account's email", async () => {
    const h = createHarness();
    const cookie = await h.signIn("ada");
    await join(h, { email: "ada@dev.localhost" }, BASE);
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { cookie }))).waitlistPlan).toBe("pro");
  });

  it("is rate limited", async () => {
    const h = createHarness({ WAITLIST_LIMITER: { limit: async () => ({ success: false }) } });
    const response = await join(h, { email: "a@example.com" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
  });
});

describe("waitlist CORS", () => {
  it("answers the preflight of the website origin only", async () => {
    const h = createHarness({ WEBSITE_ORIGINS: `http://localhost:4321, ${WEBSITE}` });
    const allowed = await h.call("OPTIONS", "/api/waitlist", { origin: WEBSITE });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(WEBSITE);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(allowed.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const other = await h.call("OPTIONS", "/api/waitlist", { origin: "https://evil.example" });
    expect(other.status).toBe(403);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses posts from other websites", async () => {
    const h = createHarness();
    const response = await join(h, { email: "a@example.com" }, "https://evil.example");
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(h.db.rows("SELECT * FROM waitlist")).toHaveLength(0);
  });

  it("has no CORS when no website origin is configured", async () => {
    const h = createHarness({ WEBSITE_ORIGINS: "" });
    expect((await h.call("OPTIONS", "/api/waitlist", { origin: WEBSITE })).status).toBe(403);
  });
});
