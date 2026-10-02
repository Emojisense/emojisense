import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WebhookDeliveryRow } from "../src/types.js";
import {
  createWebhookEvent,
  deliverOnce,
  deliverWithRetries,
  dispatchWebhookEvent,
  emitWebhookEvent,
  generateWebhookSecret,
  parseStoredEvents,
  parseWebhookEvents,
  signWebhookBody,
  verifyWebhookSignature,
  WEBHOOK_DELIVERIES_KEPT,
  WEBHOOK_EVENTS,
  type WebhookRuntime,
} from "../src/webhooks.js";
import { SqliteD1 } from "./sqlite-d1.js";

const NOW = Date.UTC(2026, 9, 15, 12);
const SECRET = "whsec_testsecret0000000000000000000000";
const URL_A = "https://hooks.example.com/a";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function setup(responses: Array<number | "network-error"> = []) {
  const db = new SqliteD1();
  const { appId } = db.seedApp();
  const clock = { now: NOW };
  const sent: Sent[] = [];
  const queue = [...responses];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const next = queue.shift() ?? 200;
    if (next === "network-error") throw new TypeError("fetch failed");
    return new Response(null, { status: next });
  });
  const sleeps: number[] = [];
  const background: Promise<unknown>[] = [];
  const runtime: WebhookRuntime = {
    db,
    fetch,
    waitUntil: (promise) => void background.push(promise),
    allowLoopback: false,
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
  };
  const addWebhook = (id: string, options: { url?: string; events?: string[]; disabled?: boolean } = {}) => {
    db.exec(
      "INSERT INTO webhooks (id, app_id, url, secret, events, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      id,
      appId,
      options.url ?? URL_A,
      SECRET,
      JSON.stringify(options.events ?? WEBHOOK_EVENTS),
      options.disabled ? 1 : null,
    );
    return { id, url: options.url ?? URL_A, secret: SECRET };
  };
  const deliveries = () =>
    db.rows<WebhookDeliveryRow>("SELECT * FROM webhook_deliveries ORDER BY created_at, rowid");
  const event = createWebhookEvent({
    type: "tenant.created",
    appId,
    data: { id: "ten_1", externalId: "acme" },
    createdAt: NOW,
  });
  const settle = async () => {
    while (background.length) await Promise.all(background.splice(0));
  };
  return { db, appId, clock, fetch, sent, sleeps, runtime, addWebhook, deliveries, event, settle };
}

describe("signatures", () => {
  it("signs `<t>.<body>` with HMAC-SHA256 of the whole secret, like a receiver computes it", async () => {
    const body = '{"id":"evt_1"}';
    const header = await signWebhookBody(SECRET, body, 1_760_000_000.9);
    const expected = createHmac("sha256", SECRET).update(`1760000000.${body}`).digest("hex");
    expect(header).toBe(`t=1760000000,v1=${expected}`);
  });

  it("verifies a valid signature and refuses tampering, wrong secrets and old timestamps", async () => {
    const body = '{"id":"evt_1"}';
    const header = await signWebhookBody(SECRET, body, 1_760_000_000);
    const verify = (overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]>) =>
      verifyWebhookSignature({ secret: SECRET, header, body, nowSeconds: 1_760_000_100, ...overrides });
    expect(await verify({})).toBe(true);
    expect(await verify({ body: '{"id":"evt_2"}' })).toBe(false);
    expect(await verify({ secret: generateWebhookSecret() })).toBe(false);
    expect(await verify({ nowSeconds: 1_760_000_301 })).toBe(false);
    expect(await verify({ header: null })).toBe(false);
    expect(await verify({ header: "t=1760000000" })).toBe(false);
    // A second v1 value (secret rotation) is accepted when one of them matches.
    expect(await verify({ header: `${header},v1=${"0".repeat(64)}` })).toBe(true);
  });

  it("generates whsec_ secrets", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("event lists", () => {
  it("defaults to every event, keeps a canonical order and refuses unknown or empty lists", () => {
    expect(parseWebhookEvents(undefined)).toEqual({ ok: true, value: [...WEBHOOK_EVENTS] });
    expect(parseWebhookEvents(["usage.threshold", "tenant.created", "tenant.created"])).toEqual({
      ok: true,
      value: ["tenant.created", "usage.threshold"],
    });
    expect(parseWebhookEvents([])).toMatchObject({ ok: false, field: "events" });
    expect(parseWebhookEvents(["tenant.renamed"])).toMatchObject({ ok: false, field: "events" });
    expect(parseWebhookEvents("tenant.created")).toMatchObject({ ok: false });
  });

  it("reads a corrupt column as no events", () => {
    expect(parseStoredEvents("oops")).toEqual([]);
    expect(parseStoredEvents('["tenant.created","nope"]')).toEqual(["tenant.created"]);
  });
});

describe("delivery", () => {
  it("POSTs the event with a valid signature and records the attempt", async () => {
    const { runtime, addWebhook, sent, deliveries, event } = setup([204]);
    const hook = addWebhook("wh_1");
    const attempt = await deliverOnce(runtime, hook, event);

    expect(attempt).toMatchObject({ webhookId: "wh_1", attempt: 1, status: 204, ok: true });
    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe(URL_A);
    expect(JSON.parse(request?.body ?? "")).toEqual({
      id: event.id,
      type: "tenant.created",
      createdAt: NOW,
      appId: event.appId,
      data: { id: "ten_1", externalId: "acme" },
    });
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers["emojisense-event"]).toBe("tenant.created");
    expect(request?.headers["emojisense-event-id"]).toBe(event.id);
    const signature = request?.headers["emojisense-signature"] ?? null;
    expect(signature).toMatch(new RegExp(`^t=${Math.floor(NOW / 1000)},v1=[0-9a-f]{64}$`));
    expect(
      await verifyWebhookSignature({
        secret: SECRET,
        header: signature,
        body: request?.body ?? "",
        nowSeconds: NOW / 1000,
      }),
    ).toBe(true);

    expect(deliveries()).toEqual([
      expect.objectContaining({ webhook_id: "wh_1", event: "tenant.created", status: 204, created_at: NOW }),
    ]);
  });

  it("does not follow redirects", async () => {
    const { runtime, addWebhook, fetch, event } = setup([302]);
    const attempt = await deliverOnce(runtime, addWebhook("wh_1"), event);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(attempt.ok).toBe(false);
  });

  it("retries at 10 s and 60 s, then stops, recording each attempt", async () => {
    const { runtime, addWebhook, sleeps, deliveries, event } = setup([500, "network-error", 503]);
    const attempts = await deliverWithRetries(runtime, addWebhook("wh_1"), event);
    expect(attempts.map((a) => [a.attempt, a.status, a.ok])).toEqual([
      [1, 500, false],
      [2, null, false],
      [3, 503, false],
    ]);
    expect(sleeps).toEqual([10_000, 60_000]);
    expect(deliveries().map((d) => [d.status, d.created_at - NOW])).toEqual([
      [500, 0],
      [null, 10_000],
      [503, 70_000],
    ]);
  });

  it("stops retrying after a success", async () => {
    const { runtime, addWebhook, sleeps, event } = setup([500, 200]);
    const attempts = await deliverWithRetries(runtime, addWebhook("wh_1"), event);
    expect(attempts.map((a) => a.status)).toEqual([500, 200]);
    expect(sleeps).toEqual([10_000]);
  });

  it("stops retrying when the webhook was deleted or disabled meanwhile", async () => {
    const { db, runtime, addWebhook, fetch, event } = setup([500, 500, 500]);
    const hook = addWebhook("wh_1");
    runtime.sleep = async () => {
      db.exec("UPDATE webhooks SET disabled_at = 1 WHERE id = 'wh_1'");
    };
    const attempts = await deliverWithRetries(runtime, hook, event);
    expect(attempts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the current URL and secret for a retry", async () => {
    const { db, runtime, addWebhook, sent, event } = setup([500, 200]);
    const hook = addWebhook("wh_1");
    runtime.sleep = async () => {
      db.exec("UPDATE webhooks SET url = 'https://hooks.example.com/b' WHERE id = 'wh_1'");
    };
    await deliverWithRetries(runtime, hook, event);
    expect(sent.map((s) => s.url)).toEqual([URL_A, "https://hooks.example.com/b"]);
  });

  it("records a refused target without a request and without retries", async () => {
    const { runtime, addWebhook, fetch, sleeps, deliveries, event } = setup();
    const hook = addWebhook("wh_1", { url: "https://169.254.169.254/latest" });
    const attempts = await deliverWithRetries(runtime, hook, event);
    expect(attempts).toEqual([expect.objectContaining({ status: null, ok: false, refused: true })]);
    expect(fetch).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
    expect(deliveries()).toHaveLength(1);
  });

  it("times out a receiver that does not answer", async () => {
    const { runtime, addWebhook, event } = setup();
    runtime.timeoutMs = 5;
    runtime.fetch = (_url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const attempt = await deliverOnce(runtime, addWebhook("wh_1"), event);
    expect(attempt).toMatchObject({ status: null, ok: false });
  });

  it(`keeps only the last ${WEBHOOK_DELIVERIES_KEPT} deliveries per webhook`, async () => {
    const { runtime, addWebhook, clock, deliveries, event } = setup();
    const first = addWebhook("wh_1");
    const second = addWebhook("wh_2", { url: "https://hooks.example.com/2" });
    await deliverOnce(runtime, second, event);
    for (let i = 0; i < WEBHOOK_DELIVERIES_KEPT + 5; i++) {
      clock.now += 1;
      await deliverOnce(runtime, first, event);
    }
    const rows = deliveries();
    const firstRows = rows.filter((r) => r.webhook_id === "wh_1");
    expect(firstRows).toHaveLength(WEBHOOK_DELIVERIES_KEPT);
    expect(firstRows[0]?.created_at).toBe(NOW + 6);
    expect(rows.filter((r) => r.webhook_id === "wh_2")).toHaveLength(1);
  });
});

describe("dispatch", () => {
  it("sends only to enabled webhooks of the app that subscribe to the event", async () => {
    const { db, runtime, addWebhook, sent, event } = setup();
    addWebhook("wh_all");
    addWebhook("wh_usage", { url: "https://hooks.example.com/usage", events: ["usage.threshold"] });
    addWebhook("wh_off", { url: "https://hooks.example.com/off", disabled: true });
    const other = db.seedApp({ accountId: "acc_2", appId: "app_2" });
    db.exec(
      "INSERT INTO webhooks (id, app_id, url, secret, events, created_at) VALUES ('wh_other', ?, 'https://other.example.com', ?, '[]', 0)",
      other.appId,
      SECRET,
    );
    await dispatchWebhookEvent(runtime, event);
    expect(sent.map((s) => s.url)).toEqual([URL_A]);
  });

  it("stays silent while the owning account is below Scale", async () => {
    const { db, runtime, addWebhook, sent, event } = setup();
    addWebhook("wh_1");
    db.exec("UPDATE accounts SET plan = 'pro'");
    await dispatchWebhookEvent(runtime, event);
    expect(sent).toEqual([]);
    db.exec("UPDATE accounts SET plan = 'scale'");
    await dispatchWebhookEvent(runtime, event);
    expect(sent).toHaveLength(1);
  });

  it("emits in the background and never throws into the caller", async () => {
    const { runtime, addWebhook, sent, settle, appId } = setup();
    addWebhook("wh_1");
    const event = emitWebhookEvent(runtime, { type: "tenant.deleted", appId, data: { id: "ten_1" } });
    expect(event).toMatchObject({ type: "tenant.deleted", appId, createdAt: NOW });
    expect(event.id).toMatch(/^evt_[A-Za-z0-9]{24}$/);
    await settle();
    expect(sent).toHaveLength(1);

    runtime.db = {
      prepare: () => {
        throw new Error("D1 down");
      },
      batch: async () => [],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    emitWebhookEvent(runtime, { type: "tenant.deleted", appId, data: {} });
    await expect(settle()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("webhook_dispatch_failed"));
    warn.mockRestore();
  });
});
