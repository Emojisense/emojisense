import { hashKey, verifyWebhookSignature, WEBHOOK_EVENTS } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import { createD1Store } from "../src/store.ts";
import { API, harness } from "./fixtures.ts";
import { memoryBucket, migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

const SECRET = "sk_live_tenants0000000000000000000000";
const PUBLISHABLE = "pk_live_tenants0000000000000000000000";
const REVOKED = "sk_live_revokedtenants000000000000000";
const HOOK_SECRET = "whsec_worker000000000000000000000000";
const NOW = Date.UTC(2026, 9, 15, 12);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const textBytes = (text: string) => new TextEncoder().encode(text);

type TenantJson = { id: string; externalId: string; emojiCount: number };
type PageJson = { tenants: TenantJson[]; nextCursor: string | null };
type EmojiJson = { id: string; tenantId: string; shortcode: string; imageUrl: string };
const read = async <T>(response: Response) => (await response.json()) as T;

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function setup(options: { plan?: string; emoji?: boolean; fetchStatus?: number } = {}) {
  const sqlite = migratedDatabase();
  sqlite
    .prepare("INSERT INTO accounts (id, name, plan, created_at) VALUES ('acc_1', 'Ada', ?, 0)")
    .run(options.plan ?? "scale");
  sqlite.exec(`
    INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_1', 'acc_1', 'Chat', 'scale', 0);
    INSERT INTO apps (id, account_id, name, created_at) VALUES ('app_2', 'acc_1', 'Other', 0);`);
  const addKey = async (id: string, key: string, kind: string, revoked: number | null = null) =>
    sqlite
      .prepare(
        `INSERT INTO api_keys (id, app_id, kind, prefix, hash, allowed_origins, created_at, revoked_at)
         VALUES (?, 'app_1', ?, ?, ?, '[]', 0, ?)`,
      )
      .run(id, kind, key.slice(0, 12), await hashKey(key), revoked);
  await addKey("key_sec", SECRET, "secret");
  await addKey("key_pub", PUBLISHABLE, "publishable");
  await addKey("key_rev", REVOKED, "secret", 1);
  sqlite
    .prepare(
      `INSERT INTO webhooks (id, app_id, url, secret, events, created_at)
       VALUES ('wh_1', 'app_1', 'https://hooks.example.com/emojisense', ?, ?, 0)`,
    )
    .run(HOOK_SECRET, JSON.stringify(WEBHOOK_EVENTS));

  const d1 = sqliteD1(sqlite);
  const bucket = memoryBucket();
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(null, { status: options.fetchStatus ?? 204 });
  });
  const h = harness({
    store: createD1Store(d1),
    env: {
      DB: d1 as unknown as D1Database,
      ...(options.emoji === false ? {} : { EMOJI: bucket as unknown as R2Bucket }),
      DEV_KEYS: "sk_live_devscale:scale",
    },
    now: () => NOW,
    fetch,
    sleep: async () => {},
  });

  const call = async (
    method: string,
    path: string,
    init: { body?: BodyInit; json?: unknown; key?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers = new Headers(init.headers);
    const key = init.key === undefined ? SECRET : init.key;
    if (key) headers.set("Authorization", `Bearer ${key}`);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const response = await h.call(
      new Request(`${API}${path}`, { method, headers, ...(body ? { body } : {}) }),
    );
    await h.ctx.settle();
    return response;
  };
  const upload = (
    externalId: string,
    fields: { file?: Uint8Array | string; shortcode?: string; aliases?: string },
  ) => {
    const form = new FormData();
    if (typeof fields.file === "string") form.append("file", fields.file);
    else if (fields.file) form.append("file", new Blob([fields.file]), "emoji.png");
    if (fields.shortcode !== undefined) form.append("shortcode", fields.shortcode);
    if (fields.aliases !== undefined) form.append("aliases", fields.aliases);
    return call("POST", `/v1/tenants/${encodeURIComponent(externalId)}/emoji`, { body: form });
  };
  const events = () => sent.map((s) => JSON.parse(s.body) as { type: string; data: Record<string, unknown> });
  return { sqlite, bucket, sent, fetch, call, upload, events, cache: h.cache };
}

describe("tenants API: auth and plan gate", () => {
  it("needs a secret key", async () => {
    const { call } = await setup();
    const anonymous = await call("GET", "/v1/tenants", { key: "" });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: "unauthorized" });

    const publishable = await call("GET", `/v1/tenants?key=${PUBLISHABLE}`, { key: "" });
    expect(publishable.status).toBe(403);
    expect(await publishable.json()).toMatchObject({ error: "secret_key_required" });

    expect((await call("GET", "/v1/tenants", { key: REVOKED })).status).toBe(401);
  });

  it("refuses a secret key sent from a browser or in the URL", async () => {
    const { call } = await setup();
    const browser = await call("GET", "/v1/tenants", { headers: { Origin: "https://app.example.com" } });
    expect(browser.status).toBe(403);
    expect((await call("GET", `/v1/tenants?key=${SECRET}`, { key: "" })).status).toBe(403);
  });

  it("refuses development keys, which have no app row", async () => {
    const { call } = await setup();
    const response = await call("GET", "/v1/tenants", { key: "sk_live_devscale" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "development_key" });
  });

  it("answers 402 plan_required below Scale, from the account's plan", async () => {
    // apps.plan says scale, but the plan lives on the account (pro).
    const { call, fetch } = await setup({ plan: "pro" });
    for (const [method, path] of [
      ["GET", "/v1/tenants"],
      ["POST", "/v1/tenants"],
      ["DELETE", "/v1/tenants/acme"],
      ["GET", "/v1/tenants/acme/emoji"],
    ] as const) {
      const response = await call(method, path, method === "POST" ? { json: { externalId: "acme" } } : {});
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({
        error: "plan_required",
        plan: "scale",
        message: expect.stringContaining("Scale"),
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 404 and 405 for paths and methods it does not have", async () => {
    const { call } = await setup();
    expect((await call("GET", "/v1/tenants/acme/other")).status).toBe(404);
    expect((await call("GET", "/v1/tenants/%E0%A4%A")).status).toBe(404);
    const wrong = await call("PUT", "/v1/tenants");
    expect(wrong.status).toBe(405);
    expect((await call("GET", "/v1/tenants/acme")).status).toBe(405);
  });
});

describe("tenants API: tenants", () => {
  it("creates a tenant once, emits tenant.created with a valid signature, and returns it after that", async () => {
    const { call, sent, events } = await setup();
    const created = await call("POST", "/v1/tenants", { json: { externalId: "acme", name: " Acme Inc " } });
    expect(created.status).toBe(201);
    const tenant = await read<TenantJson>(created);
    expect(tenant).toEqual({
      id: expect.any(String),
      externalId: "acme",
      name: "Acme Inc",
      createdAt: NOW,
      emojiCount: 0,
    });

    expect(events()).toEqual([
      expect.objectContaining({
        type: "tenant.created",
        appId: "app_1",
        data: { id: tenant.id, externalId: "acme", name: "Acme Inc", createdAt: NOW },
      }),
    ]);
    const [delivery] = sent;
    expect(delivery?.url).toBe("https://hooks.example.com/emojisense");
    expect(
      await verifyWebhookSignature({
        secret: HOOK_SECRET,
        header: delivery?.headers["emojisense-signature"] ?? null,
        body: delivery?.body ?? "",
        nowSeconds: NOW / 1000,
      }),
    ).toBe(true);

    const again = await call("POST", "/v1/tenants", { json: { externalId: "acme", name: "Other" } });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(tenant);
    expect(sent).toHaveLength(1);
  });

  it("validates the body", async () => {
    const { call } = await setup();
    const bad = await call("POST", "/v1/tenants", { json: { externalId: "a/b" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_request", field: "externalId" });
    expect((await call("POST", "/v1/tenants", { json: { externalId: "ok", name: 5 } })).status).toBe(400);
    expect((await call("POST", "/v1/tenants", { json: [1] })).status).toBe(400);
    const notJson = await call("POST", "/v1/tenants", { body: "externalId=acme" });
    expect(notJson.status).toBe(415);
    const broken = await call("POST", "/v1/tenants", {
      body: "{",
      headers: { "content-type": "application/json" },
    });
    expect(await broken.json()).toMatchObject({ error: "invalid_json" });
  });

  it("lists tenants in pages with emoji counts", async () => {
    const { call, upload } = await setup();
    for (const externalId of ["c", "a", "b"]) await call("POST", "/v1/tenants", { json: { externalId } });
    await upload("a", { file: PNG, shortcode: "wave" });
    const first = await read<PageJson>(await call("GET", "/v1/tenants?limit=2"));
    expect(first.tenants.map((t) => [t.externalId, t.emojiCount])).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
    expect(first.nextCursor).toBe("b");
    const second = await read<PageJson>(await call("GET", "/v1/tenants?limit=2&cursor=b"));
    expect(second.tenants.map((t) => t.externalId)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("deletes a tenant with its emoji and images, and emits tenant.deleted", async () => {
    const { call, upload, bucket, events, sqlite, cache } = await setup();
    await call("POST", "/v1/tenants", { json: { externalId: "acme" } });
    const one = (await (await upload("acme", { file: PNG, shortcode: "one" })).json()) as EmojiJson;
    const two = (await (await upload("acme", { file: PNG, shortcode: "two" })).json()) as EmojiJson;
    expect(bucket.objects.size).toBe(2);

    const response = await call("DELETE", "/v1/tenants/acme");
    expect(response.status).toBe(200);
    const deleted = await response.json();
    expect(deleted).toMatchObject({ tenant: { externalId: "acme" }, emojiDeleted: 2 });
    expect(deleted).not.toHaveProperty("emojiIds");
    // The cached images of this data center are purged too.
    expect([...cache.deletes].sort()).toEqual([one.imageUrl, two.imageUrl].sort());
    expect(bucket.objects.size).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM custom_emoji").get()).toEqual({ n: 0 });
    expect(events().at(-1)).toMatchObject({
      type: "tenant.deleted",
      data: { externalId: "acme", emojiDeleted: 2 },
    });
    expect((await call("DELETE", "/v1/tenants/acme")).status).toBe(404);
  });
});

describe("tenants API: tenant emoji", () => {
  async function withTenant(options: Parameters<typeof setup>[0] = {}) {
    const context = await setup(options);
    await context.call("POST", "/v1/tenants", { json: { externalId: "acme" } });
    context.sent.length = 0;
    return context;
  }

  it("uploads an emoji, stores the image and emits custom_emoji.created", async () => {
    const { upload, bucket, events } = await withTenant();
    const response = await upload("acme", {
      file: PNG,
      shortcode: ":Party_Parrot:",
      aliases: "Party Time, dance",
    });
    expect(response.status).toBe(201);
    const emoji = await read<EmojiJson>(response);
    expect(emoji).toEqual({
      id: expect.any(String),
      shortcode: "party_parrot",
      aliases: ["party time", "dance"],
      imageUrl: `${API}/v1/custom/app_1/${emoji.id}`,
      tenantId: expect.any(String),
      tenantExternalId: "acme",
      source: "api",
      bytes: PNG.byteLength,
      createdAt: NOW,
    });
    expect(bucket.objects.get(`custom/app_1/${emoji.tenantId}/${emoji.id}.png`)).toEqual({
      bytes: PNG,
      contentType: "image/png",
    });
    expect(events()).toEqual([expect.objectContaining({ type: "custom_emoji.created", data: emoji })]);
  });

  it("validates uploads", async () => {
    const { upload, call } = await withTenant();
    const cases: Array<[Parameters<typeof upload>[1], number, string]> = [
      [{ shortcode: "x" }, 400, "invalid_request"],
      [{ file: "not a file", shortcode: "x" }, 400, "invalid_request"],
      [{ file: PNG }, 400, "invalid_request"],
      [{ file: PNG, shortcode: "no spaces" }, 400, "invalid_request"],
      [{ file: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), shortcode: "jpeg" }, 415, "unsupported_image"],
      [{ file: textBytes("<svg><script>alert(1)</script></svg>"), shortcode: "evil" }, 400, "unsafe_svg"],
      [{ file: new Uint8Array(300 * 1024), shortcode: "huge" }, 413, "image_too_large"],
    ];
    for (const [fields, status, error] of cases) {
      const response = await upload("acme", fields);
      expect([response.status, (await read<{ error: string }>(response)).error]).toEqual([status, error]);
    }
    const notMultipart = await call("POST", "/v1/tenants/acme/emoji", { json: { shortcode: "x" } });
    expect(notMultipart.status).toBe(415);
    expect((await upload("nobody", { file: PNG, shortcode: "x" })).status).toBe(404);
  });

  it("refuses a duplicate shortcode for the same tenant", async () => {
    const { upload } = await withTenant();
    expect((await upload("acme", { file: PNG, shortcode: "wave" })).status).toBe(201);
    const duplicate = await upload("acme", { file: PNG, shortcode: "wave" });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: "shortcode_taken" });
  });

  it("counts every app of the account against the custom emoji limit", async () => {
    const { upload, sqlite, bucket } = await withTenant();
    // 10,000 = the Scale limit, all in the account's other app.
    sqlite.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000)
      INSERT INTO custom_emoji (id, app_id, tenant_id, shortcode, image_key, content_type, bytes, created_at)
      SELECT 'e' || i, 'app_2', '', 's' || i, 'k' || i, 'image/png', 1, 0 FROM n;`);
    const response = await upload("acme", { file: PNG, shortcode: "one_more" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "plan_limit", used: 10_000, limit: 10_000 });
    expect(bucket.objects.size).toBe(0);
  });

  it("lists the tenant's emoji with the account's usage", async () => {
    const { upload, call } = await withTenant();
    await upload("acme", { file: PNG, shortcode: "b" });
    await upload("acme", { file: PNG, shortcode: "a" });
    const body = await read<{ emoji: EmojiJson[] }>(await call("GET", "/v1/tenants/acme/emoji"));
    expect(body.emoji.map((e) => e.shortcode)).toEqual(["a", "b"]);
    expect(body).toMatchObject({ used: 2, limit: 10_000 });
  });

  it("deletes an emoji by shortcode and emits custom_emoji.deleted", async () => {
    const { upload, call, bucket, events, cache } = await withTenant();
    const emoji = await read<EmojiJson>(await upload("acme", { file: PNG, shortcode: "wave" }));
    const response = await call("DELETE", "/v1/tenants/acme/emoji/:wave:");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emoji);
    expect(bucket.objects.size).toBe(0);
    expect(cache.deletes).toEqual([emoji.imageUrl]);
    expect(events().at(-1)).toEqual(expect.objectContaining({ type: "custom_emoji.deleted", data: emoji }));
    const again = await call("DELETE", "/v1/tenants/acme/emoji/wave");
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: "emoji_not_found" });
  });

  it("answers 503 when the image bucket is not bound", async () => {
    const { upload } = await withTenant({ emoji: false });
    const response = await upload("acme", { file: PNG, shortcode: "wave" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "storage_unavailable" });
  });

  it("keeps answering when the webhook receiver fails", async () => {
    const { upload, fetch } = await withTenant({ fetchStatus: 500 });
    const response = await upload("acme", { file: PNG, shortcode: "wave" });
    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalled();
  });
});
