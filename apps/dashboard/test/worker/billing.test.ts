import { DAY_MS } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import type { BillingResponse, MeResponse } from "../../src/shared/contract";
import type { Env } from "../../src/worker/env";
import { cancelRetiredMemberships } from "../../src/worker/whop/memberships";
import { accountIdOf, BASE, body, createAppFor, createHarness, joinTeam, NOW, setPlan } from "./harness";
import { WHOP_ENV, WHOP_KEY, WHOP_PLANS } from "./whop-fixtures";

async function setup(overrides: Partial<Env> = {}) {
  const h = createHarness(overrides);
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

/** Puts an account on a paid Whop subscription, as the webhook would. */
function subscribe(
  h: ReturnType<typeof createHarness>,
  accountId: string,
  fields: { plan: string; interval?: string; status?: string; membership?: string; graceUntil?: number },
) {
  h.db.exec(
    `UPDATE accounts SET plan = ?, billing_interval = ?, billing_status = ?, whop_membership_id = ?,
       current_period_end = ?, billing_grace_until = ? WHERE id = ?`,
    fields.plan,
    fields.interval ?? "month",
    fields.status ?? "active",
    fields.membership ?? "mem_1",
    NOW + 20 * DAY_MS,
    fields.graceUntil ?? null,
    accountId,
  );
}

const purchaseUrl = "https://sandbox.whop.com/checkout/ch_test123/";

function answerCheckout(
  h: ReturnType<typeof createHarness>,
  answer: unknown = { purchase_url: purchaseUrl },
) {
  h.fetchMock.mockImplementation(async () => new Response(JSON.stringify(answer), { status: 200 }));
}

describe("GET /api/billing", () => {
  it("sums this month's usage over the account's own apps against the account plan", async () => {
    const { h, ada } = await setup();
    setPlan(h, "ada", "pro");
    const one = await createAppFor(h, ada, { name: "One" });
    const two = await createAppFor(h, ada, { name: "Two" });
    addUsage(h, one, "2026-10", "semantic_calls", 700_000);
    addUsage(h, two, "2026-10", "semantic_calls", 133_000);
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
      limits: { semantic_calls: 1_000_000, image_classifications: 10_000, custom_emoji: 2_000, apps: 3 },
      appCount: 2,
    });
    expect(billing.usage).toEqual([
      { metric: "semantic_calls", used: 833_000, limit: 1_000_000, percent: 83.3, status: "near_limit" },
      { metric: "image_classifications", used: 10, limit: 10_000, percent: 0.1, status: "ok" },
      { metric: "custom_emoji", used: 2, limit: 2_000, percent: 0.1, status: "ok" },
    ]);
  });

  it("sells nothing without Whop settings", async () => {
    const { h, ada } = await setup();
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.provider).toBeNull();
    expect(billing.purchasable).toEqual({ solo: [], pro: [], scale: [] });
    expect(billing.subscription).toEqual({
      status: "none",
      interval: null,
      currentPeriodEnd: null,
      graceUntil: null,
      manageUrl: null,
    });
  });

  it("lists what can be bought and the subscription with Whop configured", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "solo", interval: "year" });
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.provider).toBe("whop");
    expect(billing.purchasable).toEqual({ solo: ["month", "year"], pro: ["month"], scale: ["month"] });
    expect(billing.plan.id).toBe("solo");
    expect(billing.subscription).toEqual({
      status: "active",
      interval: "year",
      currentPeriodEnd: NOW + 20 * DAY_MS,
      graceUntil: null,
      // Whop sent no manage link: the sandbox's orders page.
      manageUrl: "https://sandbox.whop.com/@me/settings/orders/",
    });
  });

  it("only offers intervals that have a Whop variant", async () => {
    const { h, ada } = await setup({ ...WHOP_ENV, WHOP_PLAN_IDS: '{"pro":{"month":"plan_ProMonth"}}' });
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.purchasable).toEqual({ solo: [], pro: ["month"], scale: [] });
  });

  it("moves a past-due account whose grace ended to Free before answering", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro", status: "past_due", graceUntil: NOW - 1 });
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.plan.id).toBe("free");
    expect(billing.subscription.status).toBe("canceled");
    const me = await body<MeResponse>(await h.call("GET", "/api/me", { cookie: ada }));
    expect(me.plan.id).toBe("free");
    expect(me.billingStatus).toBe("canceled");
  });

  it("reports the grace end while past due, and /api/me says past_due", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro", status: "past_due", graceUntil: NOW + DAY_MS });
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.plan.id).toBe("pro");
    expect(billing.subscription).toMatchObject({ status: "past_due", graceUntil: NOW + DAY_MS });
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { cookie: ada }))).billingStatus).toBe(
      "past_due",
    );
  });

  it("reports unlimited apps on Scale as null", async () => {
    const { h, ada } = await setup();
    setPlan(h, "ada", "scale");
    const billing = await body<BillingResponse>(await h.call("GET", "/api/billing", { cookie: ada }));
    expect(billing.limits.apps).toBeNull();
    expect(billing.plan.maxApps).toBeNull();
  });

  it("is open to admins of the owner's team, without the manage link, and closed to developers", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro" });
    const bob = await h.signIn("bob");
    const carol = await h.signIn("carol");
    await joinTeam(h, ada, bob, "admin");
    await joinTeam(h, ada, carol, "developer");

    const admin = await h.call("GET", `/api/billing?owner=${adaId}`, { cookie: bob });
    expect(admin.status).toBe(200);
    const billing = await body<BillingResponse>(admin);
    expect(billing.plan.id).toBe("pro");
    expect(billing.subscription).toMatchObject({ status: "active", manageUrl: null });
    const developer = await h.call("GET", `/api/billing?owner=${adaId}`, { cookie: carol });
    expect(developer.status).toBe(403);
    expect(await body(developer)).toMatchObject({ error: { code: "forbidden_role" } });
  });
});

describe("POST /api/billing/checkout", () => {
  it("starts a Whop checkout for the plan's variant with the account in the metadata", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    answerCheckout(h);
    const response = await h.call("POST", "/api/billing/checkout", {
      cookie: ada,
      body: { plan: "pro", interval: "month" },
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ url: purchaseUrl });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://sandbox-api.whop.com/api/v1/checkout_configurations");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${WHOP_KEY}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: "payment",
      plan_id: WHOP_PLANS.pro.month,
      metadata: { accountId: adaId, plan: "pro", interval: "month", env: "development" },
      redirect_url: `${BASE}/billing?checkout=success`,
    });
    // Nothing changes until Whop's webhook confirms the payment.
    expect((await body<MeResponse>(await h.call("GET", "/api/me", { cookie: ada }))).plan.id).toBe("free");
  });

  it("sells Solo yearly and defaults to monthly", async () => {
    const { h, ada } = await setup(WHOP_ENV);
    answerCheckout(h);
    await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "solo", interval: "year" } });
    await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "solo" } });
    const planIds = h.fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).plan_id);
    expect(planIds).toEqual([WHOP_PLANS.solo.year, WHOP_PLANS.solo.month]);
  });

  it.each([
    [{ plan: "free" }, "plan"],
    [{ plan: "gold" }, "plan"],
    [{}, "plan"],
    [{ plan: "pro", interval: "year" }, "interval"],
    [{ plan: "solo", interval: "week" }, "interval"],
  ])("refuses %j with 400 on %s", async (input, field) => {
    const { h, ada } = await setup(WHOP_ENV);
    const response = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: input });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field } });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("needs a session and a same-origin request", async () => {
    const { h, ada } = await setup(WHOP_ENV);
    const anonymous = await h.call("POST", "/api/billing/checkout", { body: { plan: "pro" } });
    expect(anonymous.status).toBe(401);
    const crossSite = await h.call("POST", "/api/billing/checkout", {
      cookie: ada,
      body: { plan: "pro" },
      origin: "https://evil.example",
    });
    expect(crossSite.status).toBe(403);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("is for the owner only: admins cannot buy a plan for the team", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    setPlan(h, "ada", "pro");
    const bob = await h.signIn("bob");
    await joinTeam(h, ada, bob, "admin");
    const response = await h.call("POST", `/api/billing/checkout?owner=${adaId}`, {
      cookie: bob,
      body: { plan: "scale" },
    });
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      error: { code: "forbidden_role", message: "Only the owner can do this." },
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no API key", { ...WHOP_ENV, WHOP_API_KEY: undefined }],
    ["no variant for the plan", { ...WHOP_ENV, WHOP_PLAN_IDS: '{"solo":{"month":"plan_SoloMonth"}}' }],
    ["a malformed plan map", { ...WHOP_ENV, WHOP_PLAN_IDS: "{nope" }],
  ])("answers 503 with %s", async (_, env) => {
    const { h, ada } = await setup(env);
    const response = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ error: { code: "billing_unavailable" } });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the plan and interval the account already pays for, but allows a switch", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "solo", interval: "month" });
    answerCheckout(h);
    const same = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "solo" } });
    expect(same.status).toBe(409);
    expect(await body(same)).toMatchObject({ error: { code: "already_on_plan" } });

    const yearly = await h.call("POST", "/api/billing/checkout", {
      cookie: ada,
      body: { plan: "solo", interval: "year" },
    });
    expect(yearly.status).toBe(200);
    const upgrade = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(upgrade.status).toBe(200);
  });

  it("points a cancelled or past-due subscription of the same plan to Manage subscription", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro", status: "canceling" });
    const canceling = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(canceling.status).toBe(409);
    expect((await body<{ error: { message: string } }>(canceling)).error.message).toContain("resume it");

    subscribe(h, adaId, { plan: "pro", status: "past_due", graceUntil: NOW + DAY_MS });
    const pastDue = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(pastDue.status).toBe(409);
    expect((await body<{ error: { message: string } }>(pastDue)).error.message).toContain("payment method");
  });

  it("lets an account whose subscription ended buy again", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "free", status: "canceled" });
    answerCheckout(h);
    const response = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(response.status).toBe(200);
  });

  it.each([
    ["Whop answers an error", () => new Response('{"error":{"message":"nope"}}', { status: 500 })],
    ["Whop answers no URL", () => new Response("{}", { status: 200 })],
    [
      "Whop's URL is not on whop.com",
      () => new Response(JSON.stringify({ purchase_url: "https://evil.example/checkout" }), { status: 200 }),
    ],
  ])("answers 502 when %s", async (_, answer) => {
    const { h, ada } = await setup(WHOP_ENV);
    h.fetchMock.mockImplementation(async () => answer());
    const response = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({ error: { code: "checkout_failed" } });
  });

  it("answers 502 when Whop cannot be reached", async () => {
    const { h, ada } = await setup(WHOP_ENV);
    h.fetchMock.mockRejectedValue(new TypeError("network down"));
    const response = await h.call("POST", "/api/billing/checkout", { cookie: ada, body: { plan: "pro" } });
    expect(response.status).toBe(502);
  });

  it("the waitlist upgrade route is gone", async () => {
    const { h, ada } = await setup(WHOP_ENV);
    const response = await h.call("POST", "/api/billing/upgrade", { cookie: ada, body: { plan: "pro" } });
    expect(response.status).toBe(404);
  });
});

describe("account deletion with a subscription", () => {
  it("cancels the Whop membership at the end of its period", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro", membership: "mem_paid" });
    h.fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
    const response = await h.call("DELETE", "/api/me", {
      cookie: ada,
      body: { confirm: "ada@dev.localhost" },
    });
    expect(response.status).toBe(200);
    await h.settle();
    const [url, init] = h.fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://sandbox-api.whop.com/api/v1/memberships/mem_paid/cancel");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      cancellation_mode: "at_period_end",
      cancel_at_period_end: true,
    });
    // The membership stays as an anonymous retired row: it never gives a plan again.
    expect(
      h.db.rows(
        "SELECT id, account_id, retired_at IS NOT NULL AS retired, cancel_confirmed_at IS NOT NULL AS confirmed FROM whop_memberships",
      ),
    ).toEqual([{ id: "mem_paid", account_id: null, retired: 1, confirmed: 1 }]);
  });

  it("keeps the pending cancel of an earlier, replaced membership (one batch with the deletion)", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro", membership: "mem_pro" });
    // Solo was replaced by Pro, and Whop has not confirmed its cancel yet.
    h.db.exec(
      `INSERT INTO whop_memberships (id, account_id, state, event_at, retired_at, cancel_attempts, cancel_retry_at)
       VALUES ('mem_solo', ?, 'active', 0, 1, 2, ?)`,
      adaId,
      NOW + DAY_MS,
    );
    // An ended membership of the account: it simply goes.
    h.db.exec(
      "INSERT INTO whop_memberships (id, account_id, state, event_at) VALUES ('mem_old', ?, 'ended', 0)",
      adaId,
    );
    h.fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await h.call("DELETE", "/api/me", {
      cookie: ada,
      body: { confirm: "ada@dev.localhost" },
    });
    expect(response.status).toBe(200);
    await h.settle();

    const rows = () =>
      h.db.rows(
        "SELECT id, account_id, retired_at IS NOT NULL AS retired, cancel_confirmed_at FROM whop_memberships ORDER BY id",
      );
    // Both renewing memberships stay, without the account id, still to cancel.
    expect(rows()).toEqual([
      { id: "mem_pro", account_id: null, retired: 1, cancel_confirmed_at: null },
      { id: "mem_solo", account_id: null, retired: 1, cancel_confirmed_at: null },
    ]);
    // A later run (webhook or daily cron) cancels them once Whop answers.
    h.fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
    h.clock.now = NOW + 2 * DAY_MS;
    expect(await cancelRetiredMemberships(h.env, { fetch: h.fetchMock, now: () => h.clock.now })).toBe(2);
    expect(rows().map((row) => (row as { cancel_confirmed_at: number | null }).cancel_confirmed_at)).toEqual([
      h.clock.now,
      h.clock.now,
    ]);
  });

  it("calls Whop only for a subscription that still renews", async () => {
    const { h, ada, adaId } = await setup(WHOP_ENV);
    subscribe(h, adaId, { plan: "pro", status: "canceling" });
    await h.call("DELETE", "/api/me", { cookie: ada, body: { confirm: "ada@dev.localhost" } });
    await h.settle();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});
