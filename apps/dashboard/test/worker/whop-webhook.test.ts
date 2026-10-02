import { DAY_MS, PAST_DUE_GRACE_DAYS } from "@emojisense/platform";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/worker/env";
import { parseWhopEvent, planWhopEvent, type WhopEvent } from "../../src/worker/whop/events";
import { accountIdOf, body, createHarness, type Harness, NOW } from "./harness";
import {
  checkoutMetadata,
  deliver,
  membershipEvent,
  paymentEvent,
  signWhop,
  WHOP_ENV,
  WHOP_PLANS,
  WHOP_SECRET,
} from "./whop-fixtures";

interface BillingRow {
  plan: string;
  billing_status: string;
  billing_interval: string | null;
  whop_membership_id: string | null;
  current_period_end: number | null;
  billing_grace_until: number | null;
  whop_manage_url: string | null;
  billing_event_at: number | null;
}

async function setup(overrides: Partial<Env> = {}) {
  const h = createHarness({ ...WHOP_ENV, ...overrides });
  await h.signIn("ada");
  return { h, adaId: accountIdOf(h, "ada") };
}

function billingOf(h: Harness, accountId: string): BillingRow {
  const [row] = h.db.rows<BillingRow>(
    `SELECT plan, billing_status, billing_interval, whop_membership_id, current_period_end,
       billing_grace_until, whop_manage_url, billing_event_at FROM accounts WHERE id = ?`,
    accountId,
  );
  if (!row) throw new Error("no account");
  return row;
}

function parsed(h: Harness, payload: unknown): WhopEvent {
  const event = parseWhopEvent(payload, h.clock.now);
  if (!event) throw new Error("not a handled event");
  return event;
}

const eventIds = (h: Harness) => h.db.rows<{ id: string }>("SELECT id FROM whop_events").map((r) => r.id);

/** ada pays for Pro with mem_1, as after a first checkout. */
async function subscribed(h: Harness, adaId: string, plan = "pro", membershipId = "mem_1") {
  const planId =
    plan === "solo"
      ? WHOP_PLANS.solo.month
      : plan === "scale"
        ? WHOP_PLANS.scale.month
        : WHOP_PLANS.pro.month;
  const response = await deliver(
    h,
    paymentEvent(h, "payment.succeeded", {
      membershipId,
      whopPlanId: planId,
      metadata: checkoutMetadata(adaId, plan),
    }),
  );
  expect(response.status).toBe(200);
  await h.settle();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/whop/webhook: signatures", () => {
  it("accepts a delivery signed with the ws_ secret's own bytes", async () => {
    const { h, adaId } = await setup();
    const response = await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        metadata: checkoutMetadata(adaId, "pro"),
      }),
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true });
    expect(billingOf(h, adaId).plan).toBe("pro");
  });

  it.each([
    ["a wrong signature", { signature: "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }],
    ["another secret", { secret: "ws_another0000000000000000000000000000000000000000000000000000000000" }],
    // Standard Webhooks senders other than Whop key with the base64-decoded secret: not Whop.
    ["the secret without its prefix", { secret: WHOP_SECRET.slice(3) }],
    ["a changed body", { tamper: (text: string) => text.replace('"pro"', '"scale"') }],
    ["a timestamp 6 minutes old", { timestamp: Math.floor(NOW / 1000) - 6 * 60 }],
    ["a timestamp 6 minutes ahead", { timestamp: Math.floor(NOW / 1000) + 6 * 60 }],
    ["an unknown signature version", { signature: "v2,abc" }],
  ])("refuses %s with 401 and changes nothing", async (_, options) => {
    const { h, adaId } = await setup();
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        metadata: checkoutMetadata(adaId, "pro"),
      }),
      options,
    );
    expect(response.status).toBe(401);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_signature" } });
    expect(billingOf(h, adaId).plan).toBe("free");
    expect(eventIds(h)).toEqual([]);
    // The reason is logged, never the secret or the body.
    expect(JSON.stringify(log.mock.calls)).not.toContain(WHOP_SECRET);
  });

  it("accepts a timestamp within 5 minutes and any one valid entry of several", async () => {
    const { h, adaId } = await setup();
    const payload = paymentEvent(h, "payment.succeeded", {
      membershipId: "mem_1",
      whopPlanId: WHOP_PLANS.pro.month,
      metadata: checkoutMetadata(adaId, "pro"),
    });
    const timestamp = Math.floor(NOW / 1000) - 4 * 60;
    const good = signWhop(WHOP_SECRET, "msg_multi", String(timestamp), JSON.stringify(payload));
    const response = await deliver(h, payload, {
      id: "msg_multi",
      timestamp,
      signature: `v1,bm90IHRoaXMgb25l ${good}`,
    });
    expect(response.status).toBe(200);
  });

  it("refuses a delivery without the signature headers", async () => {
    const { h } = await setup();
    const response = await h.call("POST", "/api/whop/webhook", {
      origin: null,
      headers: { "content-type": "application/json" },
      rawBody: "{}",
    });
    expect(response.status).toBe(401);
  });

  it("answers 503 until the secret and the plan map are set, so Whop retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const overrides of [
      { WHOP_WEBHOOK_SECRET: undefined },
      { WHOP_PLAN_IDS: undefined },
      { WHOP_PLAN_IDS: '{"pro":{"month":"not-a-plan"}}' },
    ]) {
      const { h, adaId } = await setup(overrides);
      const response = await deliver(
        h,
        paymentEvent(h, "payment.succeeded", {
          membershipId: "mem_1",
          whopPlanId: WHOP_PLANS.pro.month,
          metadata: checkoutMetadata(adaId, "pro"),
        }),
      );
      expect(response.status).toBe(503);
      expect(eventIds(h)).toEqual([]);
    }
  });

  it("needs no session or Origin and ignores the dashboard's same-origin rule", async () => {
    const { h, adaId } = await setup();
    const payload = paymentEvent(h, "payment.succeeded", {
      membershipId: "mem_1",
      whopPlanId: WHOP_PLANS.pro.month,
      metadata: checkoutMetadata(adaId, "pro"),
    });
    const timestamp = String(Math.floor(NOW / 1000));
    const response = await h.call("POST", "/api/whop/webhook", {
      origin: "https://whop.com",
      headers: {
        "content-type": "application/json",
        "webhook-id": "msg_origin",
        "webhook-timestamp": timestamp,
        "webhook-signature": signWhop(WHOP_SECRET, "msg_origin", timestamp, JSON.stringify(payload)),
      },
      rawBody: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/whop/webhook: idempotency", () => {
  it("applies a webhook-id once; Whop's retries answer 200 and change nothing", async () => {
    const { h, adaId } = await setup();
    const payload = paymentEvent(h, "payment.succeeded", {
      membershipId: "mem_1",
      whopPlanId: WHOP_PLANS.pro.month,
      metadata: checkoutMetadata(adaId, "pro"),
    });
    expect((await deliver(h, payload, { id: "msg_once" })).status).toBe(200);
    // Changed by hand after the first delivery: a replay must not undo it.
    h.db.exec("UPDATE accounts SET plan = 'scale' WHERE id = ?", adaId);
    const replay = await deliver(h, payload, { id: "msg_once" });
    expect(replay.status).toBe(200);
    expect(await body(replay)).toEqual({ ok: true, duplicate: true });
    expect(billingOf(h, adaId).plan).toBe("scale");
    expect(eventIds(h)).toEqual(["msg_once"]);
  });

  it("records ignored events too, so retries stay cheap", async () => {
    const { h } = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const payload = paymentEvent(h, "payment.succeeded", {
      membershipId: "mem_x",
      whopPlanId: WHOP_PLANS.pro.month,
    });
    await deliver(h, payload, { id: "msg_ignored" });
    expect(eventIds(h)).toEqual(["msg_ignored"]);
    expect(await body(await deliver(h, payload, { id: "msg_ignored" }))).toEqual({
      ok: true,
      duplicate: true,
    });
  });

  it("answers 200 to event types it does not handle, without recording them", async () => {
    const { h } = await setup();
    const response = await deliver(h, {
      type: "invoice.paid",
      timestamp: new Date(NOW).toISOString(),
      data: {},
    });
    expect(response.status).toBe(200);
    expect(eventIds(h)).toEqual([]);
  });

  it("refuses a signed body that is not JSON", async () => {
    const { h } = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await deliver(h, null, { rawBody: "not json" });
    expect(response.status).toBe(400);
  });

  it("deletes event ids older than 30 days after a delivery", async () => {
    const { h, adaId } = await setup();
    h.db.exec(
      "INSERT INTO whop_events (id, type, received_at) VALUES ('msg_old', 'payment.succeeded', ?)",
      NOW - 31 * DAY_MS,
    );
    h.db.exec(
      "INSERT INTO whop_events (id, type, received_at) VALUES ('msg_recent', 'payment.succeeded', ?)",
      NOW - DAY_MS,
    );
    await subscribed(h, adaId);
    expect(eventIds(h)).toHaveLength(2);
    expect(eventIds(h)).toContain("msg_recent");
  });
});

describe("POST /api/whop/webhook: activation", () => {
  it("payment.succeeded with checkout metadata sets the plan from the Whop variant", async () => {
    const { h, adaId } = await setup();
    await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.solo.year,
        metadata: checkoutMetadata(adaId, "solo", "year"),
      }),
    );
    expect(billingOf(h, adaId)).toEqual({
      plan: "solo",
      billing_status: "active",
      billing_interval: "year",
      whop_membership_id: "mem_1",
      // A payment has no period: estimated as one year from the payment.
      current_period_end: NOW + 365 * DAY_MS,
      billing_grace_until: null,
      whop_manage_url: null,
      billing_event_at: NOW,
    });
  });

  it("membership.activated sets the exact period end and Whop's manage link", async () => {
    const { h, adaId } = await setup();
    const periodEnd = NOW + 30 * DAY_MS + 3600_000;
    await deliver(
      h,
      membershipEvent(h, "membership.activated", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.scale.month,
        metadata: checkoutMetadata(adaId, "scale"),
        periodEnd,
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "scale",
      billing_status: "active",
      whop_membership_id: "mem_1",
      current_period_end: periodEnd,
      whop_manage_url: "https://whop.com/billing/manage/mber_test/",
    });
  });

  it("reads Whop's legacy payload shape too", async () => {
    const { h, adaId } = await setup();
    const periodEnd = NOW + 30 * DAY_MS;
    await deliver(h, {
      type: "membership.activated",
      timestamp: new Date(NOW).toISOString(),
      data: {
        id: "mem_legacy",
        status: "active",
        plan: { id: WHOP_PLANS.pro.month },
        product: { id: "prod_test" },
        metadata: checkoutMetadata(adaId, "pro"),
        renewal_period_end: Math.floor(periodEnd / 1000),
        cancel_at_period_end: false,
      },
    });
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "pro",
      whop_membership_id: "mem_legacy",
      current_period_end: periodEnd,
    });
  });

  it("a renewal of the stored membership needs no metadata and moves the period on", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    h.clock.now = NOW + 30 * DAY_MS;
    await deliver(
      h,
      paymentEvent(h, "payment.succeeded", { membershipId: "mem_1", whopPlanId: WHOP_PLANS.pro.month }),
    );
    expect(billingOf(h, adaId)).toMatchObject({ plan: "pro", current_period_end: NOW + 60 * DAY_MS });
  });

  it.each([
    ["no metadata", undefined, "missing_metadata"],
    [
      "metadata without the environment",
      { accountId: "ACCOUNT", plan: "pro", interval: "month" },
      "missing_metadata",
    ],
    [
      "another environment's checkout",
      { accountId: "ACCOUNT", plan: "pro", interval: "month", env: "production" },
      "other_environment",
    ],
    [
      "an account that does not exist",
      { accountId: "acc_gone", plan: "pro", interval: "month", env: "development" },
      "unknown_account",
    ],
    [
      "metadata naming another plan than the variant",
      { accountId: "ACCOUNT", plan: "scale", interval: "month", env: "development" },
      "plan_mismatch",
    ],
    [
      "metadata naming another interval",
      { accountId: "ACCOUNT", plan: "pro", interval: "year", env: "development" },
      "plan_mismatch",
    ],
  ])("ignores a new membership with %s (200, logged, no change)", async (_, metadata, reason) => {
    const { h, adaId } = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filled = metadata && {
      ...metadata,
      accountId: metadata.accountId === "ACCOUNT" ? adaId : metadata.accountId,
    };
    const response = await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        metadata: filled,
      }),
    );
    expect(response.status).toBe(200);
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "free",
      billing_status: "none",
      whop_membership_id: null,
    });
    const logged = warn.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(logged).toContainEqual(
      expect.objectContaining({ event: "whop_event", result: "ignored", reason }),
    );
  });

  it("ignores a Whop variant that is not ours, whatever the metadata says", async () => {
    const { h, adaId } = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: "plan_SomethingElse",
        metadata: checkoutMetadata(adaId, "scale"),
      }),
    );
    expect(billingOf(h, adaId).plan).toBe("free");
  });

  it("ignores a stored membership whose metadata names another account", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    await h.signIn("bob");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.scale.month,
        metadata: checkoutMetadata(accountIdOf(h, "bob"), "scale"),
      }),
    );
    expect(billingOf(h, adaId).plan).toBe("pro");
    expect(billingOf(h, accountIdOf(h, "bob")).plan).toBe("free");
  });

  it("a new plan replaces the old membership and cancels it at the end of its period", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId, "solo", "mem_solo");
    // Whop's API answers only when the test says so: the webhook must not wait for it.
    let answerWhop = () => {};
    h.fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answerWhop = () => resolve(new Response("{}", { status: 200 }));
        }),
    );
    h.clock.now = NOW + DAY_MS;
    const response = await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_pro",
        whopPlanId: WHOP_PLANS.pro.month,
        metadata: checkoutMetadata(adaId, "pro"),
      }),
    );
    expect(response.status).toBe(200);
    expect(billingOf(h, adaId)).toMatchObject({ plan: "pro", whop_membership_id: "mem_pro" });
    answerWhop();
    await h.settle();
    const [url, init] = h.fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://sandbox-api.whop.com/api/v1/memberships/mem_solo/cancel");
    expect(JSON.parse(String(init?.body))).toMatchObject({ cancel_at_period_end: true });
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("emojisense-cancel-mem_solo");

    // When the old membership ends, the account keeps the new plan.
    h.clock.now = NOW + 20 * DAY_MS;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliver(
      h,
      membershipEvent(h, "membership.deactivated", {
        membershipId: "mem_solo",
        whopPlanId: WHOP_PLANS.solo.month,
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({ plan: "pro", billing_status: "active" });
  });

  it("logs a failed cancel of the replaced membership without failing the delivery", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId, "solo", "mem_solo");
    h.fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    h.clock.now = NOW + DAY_MS;
    const response = await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_pro",
        whopPlanId: WHOP_PLANS.pro.month,
        metadata: checkoutMetadata(adaId, "pro"),
      }),
    );
    expect(response.status).toBe(200);
    await h.settle();
    const logged = error.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(logged).toContainEqual(expect.objectContaining({ event: "whop_background_failed" }));
    expect(JSON.stringify(logged)).not.toContain("mem_solo");
  });
});

describe("POST /api/whop/webhook: failed payments, cancellation and the end", () => {
  it("payment.failed keeps the plan for the grace period; a later payment clears it", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    h.clock.now = NOW + 30 * DAY_MS;
    await deliver(
      h,
      paymentEvent(h, "payment.failed", { membershipId: "mem_1", whopPlanId: WHOP_PLANS.pro.month }),
    );
    const graceUntil = NOW + 30 * DAY_MS + PAST_DUE_GRACE_DAYS * DAY_MS;
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "pro",
      billing_status: "past_due",
      billing_grace_until: graceUntil,
    });

    // Whop's retries fail again: the grace does not start over.
    h.clock.now = NOW + 32 * DAY_MS;
    await deliver(
      h,
      paymentEvent(h, "payment.failed", { membershipId: "mem_1", whopPlanId: WHOP_PLANS.pro.month }),
    );
    expect(billingOf(h, adaId).billing_grace_until).toBe(graceUntil);

    h.clock.now = NOW + 33 * DAY_MS;
    await deliver(
      h,
      paymentEvent(h, "payment.succeeded", { membershipId: "mem_1", whopPlanId: WHOP_PLANS.pro.month }),
    );
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "pro",
      billing_status: "active",
      billing_grace_until: null,
    });
  });

  it("moves a past-due account to Free when the grace ends (on the next event)", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    await deliver(
      h,
      paymentEvent(h, "payment.failed", { membershipId: "mem_1", whopPlanId: WHOP_PLANS.pro.month }),
    );
    h.clock.now = NOW + (PAST_DUE_GRACE_DAYS + 1) * DAY_MS;
    // Any handled event sweeps all accounts (so does the owner's next dashboard visit).
    await h.signIn("bob");
    await subscribed(h, accountIdOf(h, "bob"), "pro", "mem_bob");
    expect(billingOf(h, adaId)).toMatchObject({ plan: "free", billing_status: "canceled" });
  });

  it("a failed first checkout payment changes nothing", async () => {
    const { h, adaId } = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliver(
      h,
      paymentEvent(h, "payment.failed", {
        membershipId: "mem_new",
        whopPlanId: WHOP_PLANS.pro.month,
        metadata: checkoutMetadata(adaId, "pro"),
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({ plan: "free", billing_status: "none" });
  });

  it("cancel at period end keeps the plan until it ends; resuming makes it active again", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    const periodEnd = NOW + 25 * DAY_MS;
    h.clock.now = NOW + 5 * DAY_MS;
    await deliver(
      h,
      membershipEvent(h, "membership.cancel_at_period_end_changed", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        cancelAtPeriodEnd: true,
        periodEnd,
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "pro",
      billing_status: "canceling",
      current_period_end: periodEnd,
    });

    h.clock.now = NOW + 6 * DAY_MS;
    await deliver(
      h,
      membershipEvent(h, "membership.cancel_at_period_end_changed", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        cancelAtPeriodEnd: false,
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "pro",
      billing_status: "active",
      current_period_end: periodEnd,
    });
  });

  it("membership.deactivated moves the account to Free", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    h.clock.now = NOW + 30 * DAY_MS;
    await deliver(
      h,
      membershipEvent(h, "membership.deactivated", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({
      plan: "free",
      billing_status: "canceled",
      whop_membership_id: "mem_1",
    });
  });

  it("a deactivation while past due is the grace period, not the end", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    h.clock.now = NOW + 30 * DAY_MS;
    await deliver(
      h,
      membershipEvent(h, "membership.deactivated", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        status: "past_due",
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({ plan: "pro", billing_status: "past_due" });
  });

  it("ignores events of a membership no account pays with", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const type of ["membership.deactivated", "membership.cancel_at_period_end_changed"] as const) {
      await deliver(
        h,
        membershipEvent(h, type, {
          membershipId: "mem_other",
          whopPlanId: WHOP_PLANS.pro.month,
          cancelAtPeriodEnd: true,
        }),
      );
    }
    await deliver(
      h,
      paymentEvent(h, "payment.failed", { membershipId: "mem_other", whopPlanId: WHOP_PLANS.pro.month }),
    );
    expect(billingOf(h, adaId)).toMatchObject({ plan: "pro", billing_status: "active" });
  });

  it("an older event planned at the same time as a newer one cannot overwrite it", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    const context = { db: h.db, planIds: WHOP_PLANS, environment: "development" };
    // Both read the account before either writes, as two parallel deliveries would.
    const older = await planWhopEvent(
      context,
      parsed(
        h,
        paymentEvent(h, "payment.failed", {
          membershipId: "mem_1",
          whopPlanId: WHOP_PLANS.pro.month,
          at: NOW + DAY_MS,
        }),
      ),
    );
    const newer = await planWhopEvent(
      context,
      parsed(
        h,
        membershipEvent(h, "membership.deactivated", {
          membershipId: "mem_1",
          whopPlanId: WHOP_PLANS.pro.month,
          at: NOW + 2 * DAY_MS,
        }),
      ),
    );
    assert(older.result === "applied" && newer.result === "applied");
    await h.db.batch(newer.statements);
    await h.db.batch(older.statements);
    expect(billingOf(h, adaId)).toMatchObject({ plan: "free", billing_status: "canceled" });
  });

  it("an event older than the last one applied changes nothing (Whop does not keep order)", async () => {
    const { h, adaId } = await setup();
    await subscribed(h, adaId);
    h.clock.now = NOW + 30 * DAY_MS;
    await deliver(
      h,
      membershipEvent(h, "membership.deactivated", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // A late retry of a payment from before the end.
    await deliver(
      h,
      paymentEvent(h, "payment.succeeded", {
        membershipId: "mem_1",
        whopPlanId: WHOP_PLANS.pro.month,
        at: NOW + 29 * DAY_MS,
      }),
    );
    expect(billingOf(h, adaId)).toMatchObject({ plan: "free", billing_status: "canceled" });
  });
});
