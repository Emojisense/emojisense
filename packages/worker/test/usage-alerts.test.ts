import { hashKey, PLANS, verifyWebhookSignature } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import { createD1Store } from "../src/store.ts";
import { harness, search } from "./fixtures.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

const KEY = "pk_live_usagealerts00000000000000000";
const SECOND_KEY = "pk_live_usagealerts11111111111111111";
const HOOK_SECRET = "whsec_usage0000000000000000000000000";
const OCT = Date.UTC(2026, 9, 15, 12);
const LIMIT = PLANS.scale.limits.semantic_calls;

interface Delivery {
  body: string;
  signature: string | null;
}

async function setup(options: { used: number; events?: string[]; secondAppUsed?: number }) {
  const sqlite = migratedDatabase();
  sqlite.exec(`
    INSERT INTO accounts (id, name, plan, created_at) VALUES ('acc_1', 'Ada', 'scale', 0);
    INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_1', 'acc_1', 'Chat', 'scale', 0);`);
  sqlite
    .prepare(
      `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at)
       VALUES ('key_1', 'app_1', 'publishable', ?, ?, '[]', 0)`,
    )
    .run(KEY.slice(0, 12), await hashKey(KEY));
  sqlite
    .prepare(
      `INSERT INTO webhooks (id, app_id, url, secret, events, created_at)
       VALUES ('wh_1', 'app_1', 'https://hooks.example.com/usage', ?, ?, 0)`,
    )
    .run(HOOK_SECRET, JSON.stringify(options.events ?? ["usage.threshold"]));
  sqlite
    .prepare(
      "INSERT INTO usage_monthly (app_id, period, metric, count) VALUES ('app_1', '2026-10', 'semantic_calls', ?)",
    )
    .run(options.used);
  if (options.secondAppUsed !== undefined) {
    // A second app of the same account, with its own key, usage and webhook.
    sqlite.exec(`
      INSERT INTO apps (id, account_id, name, created_at) VALUES ('app_2', 'acc_1', 'Second', 0);
      INSERT INTO webhooks (id, app_id, url, secret, events, created_at)
        VALUES ('wh_2', 'app_2', 'https://hooks.example.com/second', '${HOOK_SECRET}', '["usage.threshold"]', 0);`);
    sqlite
      .prepare(
        `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at)
         VALUES ('key_2', 'app_2', 'publishable', ?, ?, '[]', 0)`,
      )
      .run(SECOND_KEY.slice(0, 12), await hashKey(SECOND_KEY));
    sqlite
      .prepare(
        "INSERT INTO usage_monthly (app_id, period, metric, count) VALUES ('app_2', '2026-10', 'semantic_calls', ?)",
      )
      .run(options.secondAppUsed);
  }

  const d1 = sqliteD1(sqlite);
  const deliveries: Delivery[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    deliveries.push({ body: String(init.body), signature: headers["emojisense-signature"] ?? null });
    return new Response(null, { status: 200 });
  });
  const clock = { now: OCT };
  const h = harness({
    store: createD1Store(d1),
    env: { DB: d1 as unknown as D1Database },
    now: () => clock.now,
    fetch,
    sleep: async () => {},
  });
  /** One keyed search on a quiet isolate: it flushes at once (meter.ts). */
  const searchOnce = async (key = KEY) => {
    clock.now += 10_000;
    const response = await h.call(search("rocket", `&key=${key}`));
    expect(response.status).toBe(200);
    // The flush runs in waitUntil and starts the webhook delivery in another waitUntil.
    for (let i = 0; i < 3; i++) await h.ctx.settle();
  };
  const events = () =>
    deliveries.map((d) => JSON.parse(d.body) as { id: string; type: string; appId: string; data: unknown });
  return { sqlite, deliveries, fetch, searchOnce, events };
}

describe("usage.threshold webhooks from the metering flush", () => {
  it("fires 80% once, then 100% once, with a stable id and a valid signature", async () => {
    const { searchOnce, events, deliveries } = await setup({ used: LIMIT * 0.8 - 2 });
    await searchOnce(); // 80% - 1
    expect(events()).toEqual([]);
    await searchOnce(); // exactly 80%
    await searchOnce(); // past 80%
    expect(events()).toEqual([
      {
        id: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
        type: "usage.threshold",
        createdAt: expect.any(Number),
        appId: "app_1",
        data: { metric: "semantic_calls", threshold: 80, period: "2026-10", used: LIMIT * 0.8, limit: LIMIT },
      },
    ]);
    const [delivery] = deliveries;
    expect(
      await verifyWebhookSignature({
        secret: HOOK_SECRET,
        header: delivery?.signature ?? null,
        body: delivery?.body ?? "",
        nowSeconds: (OCT + 20_000) / 1000,
      }),
    ).toBe(true);
  });

  it("fires 100% at the limit and nothing after it", async () => {
    const { searchOnce, events, sqlite } = await setup({ used: LIMIT - 1 });
    await searchOnce();
    await searchOnce();
    expect(events().map((e) => (e.data as { threshold: number }).threshold)).toEqual([100]);
    // Over the limit the search answers overLimit and is not metered, so the count stays put.
    expect(sqlite.prepare("SELECT count FROM usage_monthly").get()).toEqual({ count: LIMIT });
  });

  it("counts every app of the account and tells the webhooks of each app, with one event id", async () => {
    const used = 10;
    const { searchOnce, events } = await setup({ used, secondAppUsed: LIMIT * 0.8 - used - 1 });
    await searchOnce(); // app_1 alone is far below; the account reaches exactly 80%.
    const sent = events();
    expect(sent.map((e) => e.appId).sort()).toEqual(["app_1", "app_2"]);
    expect(new Set(sent.map((e) => e.id)).size).toBe(1);
    expect(sent[0]?.data).toEqual({
      metric: "semantic_calls",
      threshold: 80,
      period: "2026-10",
      used: LIMIT * 0.8,
      limit: LIMIT,
    });
    await searchOnce();
    expect(events()).toHaveLength(2);
  });

  it("fires once when the searches of two apps take the account across the limit", async () => {
    // Each app alone is at half the limit; the account is 2 calls short of it.
    const { searchOnce, events, sqlite } = await setup({ used: LIMIT / 2, secondAppUsed: LIMIT / 2 - 2 });
    await searchOnce(KEY);
    expect(events()).toEqual([]);
    await searchOnce(SECOND_KEY); // The account reaches 100%.
    await searchOnce(KEY); // Over the limit for both apps now: not counted.
    await searchOnce(SECOND_KEY);

    const sent = events();
    expect(sent.map((e) => e.appId).sort()).toEqual(["app_1", "app_2"]);
    expect(new Set(sent.map((e) => e.id)).size).toBe(1);
    expect(sent[0]?.data).toMatchObject({ threshold: 100, used: LIMIT, limit: LIMIT });
    expect(sqlite.prepare("SELECT app_id, count FROM usage_monthly ORDER BY app_id").all()).toEqual([
      { app_id: "app_1", count: LIMIT / 2 + 1 },
      { app_id: "app_2", count: LIMIT / 2 - 1 },
    ]);
  });

  it("sends nothing to webhooks that do not subscribe to usage.threshold", async () => {
    const { searchOnce, fetch } = await setup({ used: LIMIT - 1, events: ["tenant.created"] });
    await searchOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
