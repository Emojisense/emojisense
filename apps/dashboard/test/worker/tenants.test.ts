import { customEmojiImageUrl, verifyWebhookSignature } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import type {
  CreatedWebhookResponse,
  DeletedTenantResponse,
  TenantResponse,
  TenantsResponse,
} from "../../src/shared/contract";
import { body, createAppFor, createHarness, joinTeam, NOW, setPlan } from "./harness";

const API_URL = "https://api.test";

/** An R2 stand-in that keeps objects in a Map. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
      return {};
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
}

async function setup(plan: "scale" | "pro" = "scale") {
  const bucket = memoryBucket();
  const h = createHarness({ EMOJI: bucket, API_URL });
  const cookie = await h.signIn("ada");
  setPlan(h, "ada", plan);
  const appId = await createAppFor(h, cookie);
  const tenants = `/api/apps/${appId}/tenants`;
  const create = (input: unknown, asCookie = cookie) =>
    h.call("POST", tenants, { cookie: asCookie, body: input });
  return { h, bucket, cookie, appId, tenants, create };
}

/** A custom emoji row and its image, as the custom emoji upload stores them. */
function seedEmoji(context: Awaited<ReturnType<typeof setup>>, tenantId: string, shortcode: string): string {
  const key = `custom/${context.appId}/${tenantId}/${shortcode}.png`;
  context.h.db.exec(
    `INSERT INTO custom_emoji (id, app_id, tenant_id, shortcode, image_key, content_type, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, 'image/png', 4, 0)`,
    `e_${tenantId}_${shortcode}`,
    context.appId,
    tenantId,
    shortcode,
    key,
  );
  context.bucket.objects.set(key, new Uint8Array([1, 2, 3, 4]));
  return key;
}

describe("tenants: plan gate and roles", () => {
  it("answers 402 plan_required below Scale", async () => {
    const { h, cookie, tenants, create } = await setup("pro");
    for (const response of [await h.call("GET", tenants, { cookie }), await create({ externalId: "acme" })]) {
      expect(response.status).toBe(402);
      expect(await body(response)).toEqual({
        error: { code: "plan_required", plan: "scale", message: expect.stringContaining("Scale") },
      });
    }
  });

  it("hides another account's app and needs the developer role to write", async () => {
    const { h, cookie, tenants, create } = await setup();
    const stranger = await h.signIn("eve");
    expect((await h.call("GET", tenants, { cookie: stranger })).status).toBe(404);

    const viewer = await h.signIn("vic");
    await joinTeam(h, cookie, viewer, "viewer");
    expect((await h.call("GET", tenants, { cookie: viewer })).status).toBe(200);
    const denied = await create({ externalId: "acme" }, viewer);
    expect(denied.status).toBe(403);
    expect(await body(denied)).toMatchObject({ error: { code: "forbidden_role" } });

    const developer = await h.signIn("dev");
    await joinTeam(h, cookie, developer, "developer");
    expect((await create({ externalId: "acme" }, developer)).status).toBe(201);
  });

  it("needs a session", async () => {
    const { h, tenants } = await setup();
    expect((await h.call("GET", tenants)).status).toBe(401);
  });
});

describe("tenants: create, list, get, delete", () => {
  it("creates a tenant, refuses a taken externalId and validates the body", async () => {
    const { create } = await setup();
    const response = await create({ externalId: "acme", name: "  Acme Inc " });
    expect(response.status).toBe(201);
    expect(await body<TenantResponse>(response)).toEqual({
      tenant: { id: expect.any(String), externalId: "acme", name: "Acme Inc", createdAt: NOW, emojiCount: 0 },
    });

    const taken = await create({ externalId: "acme" });
    expect(taken.status).toBe(409);
    expect(await body(taken)).toMatchObject({ error: { code: "tenant_exists", field: "externalId" } });

    const invalid = await create({ externalId: "a b" });
    expect(invalid.status).toBe(400);
    expect(await body(invalid)).toMatchObject({ error: { code: "invalid_request", field: "externalId" } });
    expect((await create({ externalId: "ok", name: 3 })).status).toBe(400);
  });

  it("lists tenants by externalId with emoji counts, in pages", async () => {
    const context = await setup();
    const { h, cookie, tenants, create } = context;
    const ids: Record<string, string> = {};
    for (const externalId of ["c", "a", "b"]) {
      ids[externalId] = (await body<TenantResponse>(await create({ externalId }))).tenant.id;
    }
    seedEmoji(context, ids.a ?? "", "wave");
    seedEmoji(context, ids.a ?? "", "party");

    const first = await body<TenantsResponse>(await h.call("GET", `${tenants}?limit=2`, { cookie }));
    expect(first.tenants.map((t) => [t.externalId, t.emojiCount])).toEqual([
      ["a", 2],
      ["b", 0],
    ]);
    expect(first.nextCursor).toBe("b");
    const second = await body<TenantsResponse>(
      await h.call("GET", `${tenants}?limit=2&cursor=b`, { cookie }),
    );
    expect(second).toEqual({ tenants: [expect.objectContaining({ externalId: "c" })], nextCursor: null });

    const one = await body<TenantResponse>(await h.call("GET", `${tenants}/${ids.a}`, { cookie }));
    expect(one.tenant).toMatchObject({ externalId: "a", emojiCount: 2 });
    expect((await h.call("GET", `${tenants}/missing`, { cookie })).status).toBe(404);
  });

  it("deletes a tenant with its emoji rows and images, and leaves the others", async () => {
    const context = await setup();
    const { h, bucket, cookie, tenants, create } = context;
    const acme = (await body<TenantResponse>(await create({ externalId: "acme" }))).tenant;
    const other = (await body<TenantResponse>(await create({ externalId: "other" }))).tenant;
    seedEmoji(context, acme.id, "wave");
    seedEmoji(context, acme.id, "party");
    const kept = seedEmoji(context, other.id, "wave");

    const response = await h.call("DELETE", `${tenants}/${acme.id}`, { cookie });
    expect(response.status).toBe(200);
    expect(await body<DeletedTenantResponse>(response)).toEqual({
      tenant: { ...acme, emojiCount: 2 },
      emojiDeleted: 2,
    });
    expect([...bucket.objects.keys()]).toEqual([kept]);
    expect(h.db.rows("SELECT tenant_id FROM custom_emoji")).toEqual([{ tenant_id: other.id }]);
    // The API Worker's cached images in this data center go now, as with a single emoji delete.
    expect(h.purged.sort()).toEqual(
      [`e_${acme.id}_wave`, `e_${acme.id}_party`]
        .map((id) => customEmojiImageUrl(API_URL, context.appId, id))
        .sort(),
    );
    expect((await h.call("DELETE", `${tenants}/${acme.id}`, { cookie })).status).toBe(404);
  });
});

describe("tenants: webhook events", () => {
  it("emits signed tenant.created and tenant.deleted events", async () => {
    const { h, cookie, appId, tenants, create } = await setup();
    const sent: Array<{ url: string; body: string; signature: string | null }> = [];
    h.fetchMock.mockImplementation(async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      sent.push({ url, body: String(init?.body), signature: headers["emojisense-signature"] ?? null });
      return new Response(null, { status: 204 });
    });
    const hook = await body<CreatedWebhookResponse>(
      await h.call("POST", `/api/apps/${appId}/webhooks`, {
        cookie,
        body: { url: "https://hooks.example.com/emojisense", events: ["tenant.created", "tenant.deleted"] },
      }),
    );

    const { tenant } = await body<TenantResponse>(await create({ externalId: "acme", name: "Acme" }));
    await h.call("DELETE", `${tenants}/${tenant.id}`, { cookie });
    await h.settle();

    const events = sent.map((s) => JSON.parse(s.body) as { type: string; appId: string; data: unknown });
    expect(events).toEqual([
      expect.objectContaining({
        type: "tenant.created",
        appId,
        data: { id: tenant.id, externalId: "acme", name: "Acme", createdAt: NOW },
      }),
      expect.objectContaining({
        type: "tenant.deleted",
        data: { id: tenant.id, externalId: "acme", name: "Acme", createdAt: NOW, emojiDeleted: 0 },
      }),
    ]);
    for (const delivery of sent) {
      const valid = await verifyWebhookSignature({
        secret: hook.secret,
        header: delivery.signature,
        body: delivery.body,
        nowSeconds: NOW / 1000,
      });
      expect(valid).toBe(true);
    }
  });
});
