import { describe, expect, it } from "vitest";
import type { BillingResponse, MeResponse } from "../../src/shared/contract";
import { accountIdOf, body, createAppFor, createHarness, joinTeam, NOW, setPlan } from "./harness";

async function setup() {
  const h = createHarness();
  const ada = await h.signIn("ada");
  return { h, ada, adaId: accountIdOf(h, "ada") };
}

function addUsage(
  h: ReturnType<typeof createHarness>,
  appId: string,
  period: string,
  metric: string,
  n: number,
) {
  h.db.exec(
    "INSERT INTO usage_monthly (app_id, period, metric, count) VALUES (?, ?, ?, ?)",
    appId,
    period,
    metric,
    n,
  );
}

describe("GET /api/billing", () => {
  it("sums this month's usage over the account's own apps against the account plan", async () => {
    const { h, ada } = await setup();
    setPlan(h, "ada", "pro");
    const one = await createAppFor(h, ada, { name: "One" });
    const two = await createAppFor(h, ada, { name: "Two" });
    addUsage(h, one, "2026-10", "semantic_calls", 2_000_000);
    addUsage(h, two, "2026-10", "semantic_calls", 500_000);
    addUsage(h, two, "2026-09", "semantic_calls", 9_000_000);
    addUsage(h, one, "2026-10", "image_classifications", 10);
    h.db.exec(
      `INSERT INTO custom_emoji (id, app_id, shortcode, image_key, content_type, bytes, created_at)
       VALUES ('e1', ?, 'party', 'k1', 'image/png', 10, 0), ('e2', ?, 'yay', 'k2', 'image/png', 10, 0)`,
      one,
      two,
    );
    // Another account's usage never counts.
    const bob = await h.signIn("bob");
    addUsage(h, await createAppFor(h, bob), "2026-10", "semantic_calls", 7);

    const response = await h.call("GET", "/api/billing", { cookie: ada });
    expect(response.status).toBe(200);
    const billing = await body<BillingResponse>(response);
    expect(billing).toMatchObject({
      plan: { id: "pro", name: "Pro", teamMembers: true, analyticsRetentionDays: 30 },
      period: "2026-10",
      limits: { semantic_calls: 3_000_000, image_classifications: 10_000, custom_emoji: 2_000, apps: 3 },
      appCount: 2,
      provider: null,
      waitlistPlan: null,
    });
    expect(billing.usage).toEqual([
      { metric: "semantic_calls", used: 2_500_000, limit: 3_000_000, percent: 83.3, status: "near_limit" },
      { metric: "image_classifications", used: 10, limit: 10_000, percent: 0.1, status: "ok" },
      { metric: "custom_emoji", used: 2, limit: 2_000, percent: 0.1, status: "ok" },
    ]);
  });

  it("reports unlimited apps on Scale as null", async () => {
    const { h, ada } = await setup();
    setPlan(h, "ada", "scale");
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.limits.apps).toBeNull();
    expect(billing.plan.maxApps).toBeNull();
  });

  it("is open to admins of the owner's team and closed to developers", async () => {
    const { h, ada, adaId } = await setup();
    setPlan(h, "ada", "pro");
    const bob = await h.signIn("bob");
    const carol = await h.signIn("carol");
    await joinTeam(h, ada, bob, "admin");
    await joinTeam(h, ada, carol, "developer");

    const admin = await h.call("GET", `/api/billing?owner=${adaId}`, { cookie: bob });
    expect(admin.status).toBe(200);
    expect((await body<BillingResponse>(admin)).plan.id).toBe("pro");
    const developer = await h.call("GET", `/api/billing?owner=${adaId}`, { cookie: carol });
    expect(developer.status).toBe(403);
    expect(await body(developer)).toMatchObject({ error: { code: "forbidden_role" } });
  });
});

describe("POST /api/billing/upgrade", () => {
  it("puts the account on the waitlist and never changes the plan", async () => {
    const { h, ada } = await setup();
    const response = await h.call("POST", "/api/billing/upgrade", { cookie: ada, body: { plan: "pro" } });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ status: "waitlist", plan: "pro" });
    expect(h.db.rows("SELECT email, plan, created_at FROM waitlist")).toEqual([
      { email: "ada@dev.localhost", plan: "pro", created_at: NOW },
    ]);
    const me = await body<MeResponse>(await h.call("GET", "/api/me", { cookie: ada }));
    expect(me.plan.id).toBe("free");
    expect(me.waitlistPlan).toBe("pro");
    expect(h.fetchMock).not.toHaveBeenCalled();

    // Asking again records the latest plan.
    await h.call("POST", "/api/billing/upgrade", { cookie: ada, body: { plan: "scale" } });
    expect(h.db.rows("SELECT plan FROM waitlist")).toEqual([{ plan: "scale" }]);
  });

  it.each([
    [{ plan: "free" }, 400, "invalid_request"],
    [{ plan: "gold" }, 400, "invalid_request"],
    [{}, 400, "invalid_request"],
    [{ plan: "solo" }, 409, "plan_not_higher"],
    [{ plan: "pro" }, 409, "plan_not_higher"],
  ])("refuses %j on Pro with %d", async (input, status, code) => {
    const { h, ada } = await setup();
    setPlan(h, "ada", "pro");
    const response = await h.call("POST", "/api/billing/upgrade", { cookie: ada, body: input });
    expect(response.status).toBe(status);
    expect(await body(response)).toMatchObject({ error: { code, field: "plan" } });
    expect(h.db.rows("SELECT * FROM waitlist")).toEqual([]);
  });

  it("asks for an email when the account has none", async () => {
    const { h, ada } = await setup();
    h.db.exec("UPDATE accounts SET email = NULL");
    const missing = await h.call("POST", "/api/billing/upgrade", { cookie: ada, body: { plan: "solo" } });
    expect(missing.status).toBe(400);
    expect(await body(missing)).toMatchObject({ error: { code: "invalid_request", field: "email" } });

    const given = await h.call("POST", "/api/billing/upgrade", {
      cookie: ada,
      body: { plan: "solo", email: "Ada@Example.com" },
    });
    expect(given.status).toBe(200);
    expect(h.db.rows("SELECT email, plan FROM waitlist")).toEqual([
      { email: "ada@example.com", plan: "solo" },
    ]);
  });

  it("is for the owner only: admins cannot change the plan", async () => {
    const { h, ada, adaId } = await setup();
    setPlan(h, "ada", "pro");
    const bob = await h.signIn("bob");
    await joinTeam(h, ada, bob, "admin");
    const response = await h.call("POST", `/api/billing/upgrade?owner=${adaId}`, {
      cookie: bob,
      body: { plan: "scale" },
    });
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      error: { code: "forbidden_role", message: "Only the owner can do this." },
    });
    expect(h.db.rows("SELECT * FROM waitlist")).toEqual([]);
  });
});
