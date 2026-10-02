import { verifyWebhookSignature, WEBHOOK_EVENTS } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import type {
  CreatedWebhookResponse,
  WebhookDeliveriesResponse,
  WebhookResponse,
  WebhooksResponse,
  WebhookTestResponse,
} from "../../src/shared/contract";
import { body, createAppFor, createHarness, joinTeam, NOW, setPlan } from "./harness";

const HOOK_URL = "https://hooks.example.com/emojisense";

async function setup(plan: "scale" | "pro" = "scale") {
  const h = createHarness();
  // A Clerk session, so the SSRF tests can switch ENVIRONMENT to production (dev sign-in stops there).
  const cookie = await h.clerkSignIn("ada");
  setPlan(h, "ada", plan);
  const appId = await createAppFor(h, cookie);
  const webhooks = `/api/apps/${appId}/webhooks`;
  const create = async (input: unknown = { url: HOOK_URL }, asCookie = cookie) =>
    h.call("POST", webhooks, { cookie: asCookie, body: input });
  const created = async (input?: unknown) => body<CreatedWebhookResponse>(await create(input));
  return { h, cookie, appId, webhooks, create, created };
}

describe("webhooks: create and list", () => {
  it("returns the secret once, at creation, and never in a list", async () => {
    const { h, cookie, appId, webhooks, create } = await setup();
    const response = await create({ url: `${HOOK_URL}#ignored` });
    expect(response.status).toBe(201);
    const { webhook, secret } = await body<CreatedWebhookResponse>(response);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
    expect(webhook).toEqual({
      id: expect.any(String),
      appId,
      url: HOOK_URL,
      events: [...WEBHOOK_EVENTS],
      enabled: true,
      createdAt: NOW,
      disabledAt: null,
      lastDelivery: null,
    });

    const list = await h.call("GET", webhooks, { cookie });
    const text = await list.text();
    expect(text).not.toContain(secret);
    expect((JSON.parse(text) as WebhooksResponse).webhooks).toEqual([webhook]);
  });

  it("keeps the subscribed events and refuses unknown or empty lists", async () => {
    const { create, created } = await setup();
    const { webhook } = await created({ url: HOOK_URL, events: ["usage.threshold", "tenant.created"] });
    expect(webhook.events).toEqual(["tenant.created", "usage.threshold"]);
    for (const events of [[], ["nope"], "tenant.created"]) {
      const response = await create({ url: HOOK_URL, events });
      expect(response.status).toBe(400);
      expect(await body(response)).toMatchObject({ error: { field: "events" } });
    }
  });

  it("allows at most 10 webhooks per app", async () => {
    const { create } = await setup();
    for (let i = 0; i < 10; i++) expect((await create({ url: `${HOOK_URL}/${i}` })).status).toBe(201);
    const response = await create();
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ error: { code: "webhook_limit" } });
  });
});

describe("webhooks: URL rules (SSRF guard)", () => {
  it("allows http://localhost in development only", async () => {
    const { h, create } = await setup();
    expect((await create({ url: "http://localhost:3000/hooks" })).status).toBe(201);
    h.env.ENVIRONMENT = "production";
    const response = await create({ url: "http://localhost:3000/hooks" });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field: "url" } });
    expect((await create({ url: "http://hooks.example.com/" })).status).toBe(400);
  });

  it.each([
    "https://10.0.0.1/hook",
    "https://192.168.1.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
    "https://metadata.google.internal/",
    "https://intranet/hook",
    "https://user:pw@hooks.example.com/",
    "javascript:alert(1)",
    "",
  ])("refuses %s in production", async (url) => {
    const { h, create } = await setup();
    h.env.ENVIRONMENT = "production";
    const response = await create({ url });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { field: "url" } });
  });

  it("checks a changed URL too", async () => {
    const { h, cookie, created } = await setup();
    const { webhook } = await created();
    const response = await h.call("PATCH", `/api/webhooks/${webhook.id}`, {
      cookie,
      body: { url: "https://10.1.2.3/hook" },
    });
    expect(response.status).toBe(400);
  });

  it("refuses private targets other than loopback in development too", async () => {
    const { create } = await setup();
    expect((await create({ url: "https://192.168.1.1/hook" })).status).toBe(400);
    expect((await create({ url: "https://[::1]:8443/hook" })).status).toBe(201);
  });
});

describe("webhooks: update, delete, test, deliveries", () => {
  it("updates the URL, the events and enabled", async () => {
    const { h, cookie, created } = await setup();
    const { webhook } = await created();
    const path = `/api/webhooks/${webhook.id}`;
    h.clock.now = NOW + 1000;
    const response = await h.call("PATCH", path, {
      cookie,
      body: { url: `${HOOK_URL}/v2`, events: ["custom_emoji.created"], enabled: false },
    });
    expect(response.status).toBe(200);
    expect((await body<WebhookResponse>(response)).webhook).toMatchObject({
      url: `${HOOK_URL}/v2`,
      events: ["custom_emoji.created"],
      enabled: false,
      disabledAt: NOW + 1000,
    });
    const enabled = await body<WebhookResponse>(
      await h.call("PATCH", path, { cookie, body: { enabled: true } }),
    );
    expect(enabled.webhook).toMatchObject({ enabled: true, disabledAt: null, url: `${HOOK_URL}/v2` });

    expect((await h.call("PATCH", path, { cookie, body: {} })).status).toBe(400);
    expect((await h.call("PATCH", path, { cookie, body: { enabled: "no" } })).status).toBe(400);
  });

  it("sends at most 5 test events a minute per webhook", async () => {
    const { h, cookie, created } = await setup();
    const first = (await created()).webhook;
    const second = (await created({ url: `${HOOK_URL}/other` })).webhook;
    const used = new Map<string, number>();
    const keys: string[] = [];
    h.env.WEBHOOK_TEST_LIMITER = {
      limit: async ({ key }) => {
        keys.push(key);
        used.set(key, (used.get(key) ?? 0) + 1);
        return { success: (used.get(key) ?? 0) <= 5 };
      },
    };
    h.fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const test = (id: string) => h.call("POST", `/api/webhooks/${id}/test`, { cookie });
    for (let i = 0; i < 5; i++) expect((await test(first.id)).status).toBe(200);
    const limited = await test(first.id);
    expect(limited.status).toBe(429);
    expect(await body(limited)).toMatchObject({ error: { code: "rate_limited" } });
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
    expect((await test(second.id)).status).toBe(200);
    expect(new Set(keys)).toEqual(new Set([first.id, second.id]));
  });

  it("sends a signed test event, records it and lists deliveries newest first", async () => {
    const { h, cookie, appId, created } = await setup();
    const { webhook, secret } = await created();
    const sent: Array<{ body: string; signature: string | null }> = [];
    h.fetchMock.mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      sent.push({ body: String(init?.body), signature: headers["emojisense-signature"] ?? null });
      return new Response(null, { status: sent.length === 1 ? 200 : 500 });
    });

    const ok = await h.call("POST", `/api/webhooks/${webhook.id}/test`, { cookie });
    expect(ok.status).toBe(200);
    expect(await body<WebhookTestResponse>(ok)).toEqual({
      delivery: {
        id: expect.any(String),
        event: "webhook.test",
        status: 200,
        ok: true,
        durationMs: 0,
        createdAt: NOW,
      },
    });
    const event = JSON.parse(sent[0]?.body ?? "{}");
    expect(event).toMatchObject({ type: "webhook.test", appId, data: { webhookId: webhook.id } });
    expect(
      await verifyWebhookSignature({
        secret,
        header: sent[0]?.signature ?? null,
        body: sent[0]?.body ?? "",
        nowSeconds: NOW / 1000,
      }),
    ).toBe(true);

    h.clock.now = NOW + 5;
    const failed = await body<WebhookTestResponse>(
      await h.call("POST", `/api/webhooks/${webhook.id}/test`, { cookie }),
    );
    expect(failed.delivery).toMatchObject({ status: 500, ok: false });
    expect(sent).toHaveLength(2); // a test is sent once, without retries

    const { deliveries } = await body<WebhookDeliveriesResponse>(
      await h.call("GET", `/api/webhooks/${webhook.id}/deliveries`, { cookie }),
    );
    expect(deliveries.map((d) => [d.status, d.ok])).toEqual([
      [500, false],
      [200, true],
    ]);
    const list = await body<WebhooksResponse>(await h.call("GET", `/api/apps/${appId}/webhooks`, { cookie }));
    expect(list.webhooks[0]?.lastDelivery).toMatchObject({ status: 500, createdAt: NOW + 5 });
  });

  it("reports a network error as status null", async () => {
    const { h, cookie, created } = await setup();
    const { webhook } = await created();
    h.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await body<WebhookTestResponse>(
      await h.call("POST", `/api/webhooks/${webhook.id}/test`, { cookie }),
    );
    expect(response.delivery).toMatchObject({ status: null, ok: false });
  });

  it("deletes a webhook with its deliveries", async () => {
    const { h, cookie, created } = await setup();
    const { webhook } = await created();
    h.fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await h.call("POST", `/api/webhooks/${webhook.id}/test`, { cookie });
    const response = await h.call("DELETE", `/api/webhooks/${webhook.id}`, { cookie });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true });
    expect(h.db.rows("SELECT * FROM webhook_deliveries")).toEqual([]);
    expect((await h.call("DELETE", `/api/webhooks/${webhook.id}`, { cookie })).status).toBe(404);
  });
});

describe("webhooks: access and plan gate", () => {
  it("answers 402 plan_required below Scale, also for an existing webhook after a downgrade", async () => {
    const { h, cookie, webhooks, created } = await setup();
    const { webhook } = await created();
    setPlan(h, "ada", "pro");
    for (const response of [
      await h.call("GET", webhooks, { cookie }),
      await h.call("GET", `/api/webhooks/${webhook.id}/deliveries`, { cookie }),
      await h.call("POST", `/api/webhooks/${webhook.id}/test`, { cookie }),
    ]) {
      expect(response.status).toBe(402);
      expect(await body(response)).toMatchObject({ error: { code: "plan_required", plan: "scale" } });
    }
  });

  it("lets viewers read but not write, and hides webhooks of other accounts", async () => {
    const { h, cookie, webhooks, create, created } = await setup();
    const { webhook } = await created();
    const viewer = await h.signIn("vic");
    await joinTeam(h, cookie, viewer, "viewer");

    expect((await h.call("GET", webhooks, { cookie: viewer })).status).toBe(200);
    expect((await h.call("GET", `/api/webhooks/${webhook.id}/deliveries`, { cookie: viewer })).status).toBe(
      200,
    );
    for (const response of [
      await create({ url: HOOK_URL }, viewer),
      await h.call("PATCH", `/api/webhooks/${webhook.id}`, { cookie: viewer, body: { enabled: false } }),
      await h.call("DELETE", `/api/webhooks/${webhook.id}`, { cookie: viewer }),
      await h.call("POST", `/api/webhooks/${webhook.id}/test`, { cookie: viewer }),
    ]) {
      expect(response.status).toBe(403);
    }

    const stranger = await h.signIn("eve");
    expect((await h.call("GET", `/api/webhooks/${webhook.id}/deliveries`, { cookie: stranger })).status).toBe(
      404,
    );
    expect((await h.call("DELETE", `/api/webhooks/${webhook.id}`, { cookie: stranger })).status).toBe(404);
    expect((await h.call("GET", webhooks, { cookie: stranger })).status).toBe(404);
  });

  it("lets a developer manage webhooks", async () => {
    const { h, cookie, create } = await setup();
    const developer = await h.signIn("dev");
    await joinTeam(h, cookie, developer, "developer");
    expect((await create({ url: HOOK_URL }, developer)).status).toBe(201);
  });
});
