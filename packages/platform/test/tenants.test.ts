import { describe, expect, it } from "vitest";
import { createCustomEmoji } from "../src/custom-emoji-store.js";
import { PLANS } from "../src/plans.js";
import { loadAppOwner, lowestPlanFor, planAllows } from "../src/scale-features.js";
import {
  createTenant,
  deleteTenant,
  findTenantByExternalId,
  listTenants,
  parseExternalId,
  parsePageLimit,
  parseTenantName,
} from "../src/tenants.js";
import { pngImage } from "./fakes.js";
import { memoryBucket, SqliteD1 } from "./sqlite-d1.js";

describe("plan gate", () => {
  it("allows tenants and webhooks on Scale only and names Scale as the plan to buy", () => {
    expect(
      Object.values(PLANS)
        .filter((p) => planAllows(p, "tenants"))
        .map((p) => p.id),
    ).toEqual(["scale"]);
    expect(planAllows(PLANS.pro, "webhooks")).toBe(false);
    expect(lowestPlanFor("tenants")).toBe("scale");
    expect(lowestPlanFor("webhooks")).toBe("scale");
  });

  it("reads the plan from the account that owns the app", async () => {
    const db = new SqliteD1();
    db.seedApp({ plan: "scale" });
    db.exec("UPDATE apps SET plan = 'free'");
    expect(await loadAppOwner(db, "app_1")).toMatchObject({ accountId: "acc_1", plan: { id: "scale" } });
    expect(await loadAppOwner(db, "missing")).toBeUndefined();
  });
});

describe("tenant fields", () => {
  it("accepts URL-safe external ids", () => {
    expect(parseExternalId("org_42")).toEqual({ ok: true, value: "org_42" });
    expect(parseExternalId("ada@example.com").ok).toBe(true);
    expect(parseExternalId("8c4f1c4e-1f7a-4a8e-9d2a-0b6f3f1d2c3e").ok).toBe(true);
    expect(parseExternalId("a/b")).toMatchObject({ ok: false, field: "externalId" });
    expect(parseExternalId("")).toMatchObject({ ok: false });
    expect(parseExternalId("x".repeat(129))).toMatchObject({ ok: false });
    expect(parseExternalId(42)).toMatchObject({ ok: false });
  });

  it("trims names and refuses control characters", () => {
    expect(parseTenantName("  Acme  ")).toEqual({ ok: true, value: "Acme" });
    expect(parseTenantName("")).toEqual({ ok: true, value: null });
    expect(parseTenantName(undefined)).toEqual({ ok: true, value: null });
    expect(parseTenantName("a\u0000b")).toMatchObject({ ok: false, field: "name" });
    expect(parseTenantName("x".repeat(101))).toMatchObject({ ok: false });
  });

  it("bounds page sizes", () => {
    expect(parsePageLimit(null)).toBe(100);
    expect(parsePageLimit("10")).toBe(10);
    expect(parsePageLimit("9999")).toBe(500);
    expect(parsePageLimit("0")).toBe(100);
    expect(parsePageLimit("abc")).toBe(100);
  });
});

describe("tenants", () => {
  function setup() {
    const db = new SqliteD1();
    const { accountId, appId } = db.seedApp();
    const bucket = memoryBucket();
    let ids = 0;
    const put = (tenantId: string | null, shortcode: string) =>
      createCustomEmoji(db, bucket, {
        appId,
        accountId,
        limit: 10,
        tenantId,
        shortcode,
        aliases: [],
        image: pngImage(),
        source: "api",
        now: 5,
        id: `e${++ids}`,
      });
    return { db, bucket, put, accountId, appId };
  }

  it("creates once per external id and returns the existing tenant after that", async () => {
    const { db, appId } = setup();
    const first = await createTenant(db, { appId, externalId: "acme", name: "Acme", now: 1 });
    expect(first.created).toBe(true);
    expect(first.tenant).toMatchObject({ app_id: appId, external_id: "acme", name: "Acme", created_at: 1 });
    const again = await createTenant(db, { appId, externalId: "acme", name: "Renamed", now: 2 });
    expect(again).toEqual({ tenant: first.tenant, created: false });
    expect(db.rows("SELECT * FROM tenants")).toHaveLength(1);
  });

  it("lists by external id with emoji counts and a cursor", async () => {
    const { db, put, appId } = setup();
    for (const externalId of ["c", "a", "b"])
      await createTenant(db, { appId, externalId, name: null, now: 1 });
    const a = await findTenantByExternalId(db, appId, "a");
    for (const shortcode of ["x", "y"]) await put(a?.id ?? null, shortcode);
    const page1 = await listTenants(db, appId, { limit: 2, cursor: null });
    expect(page1.tenants.map((t) => [t.externalId, t.emojiCount])).toEqual([
      ["a", 2],
      ["b", 0],
    ]);
    expect(page1.nextCursor).toBe("b");
    const page2 = await listTenants(db, appId, { limit: 2, cursor: page1.nextCursor });
    expect(page2).toEqual({
      tenants: [expect.objectContaining({ externalId: "c", emojiCount: 0 })],
      nextCursor: null,
    });
  });

  it("deletes the tenant with its emoji rows and images, and leaves other tenants alone", async () => {
    const { db, bucket, put, appId } = setup();
    const { tenant } = await createTenant(db, { appId, externalId: "acme", name: null, now: 1 });
    const { tenant: other } = await createTenant(db, { appId, externalId: "other", name: null, now: 1 });
    await put(tenant.id, "a");
    await put(tenant.id, "b");
    await put(other.id, "a");

    expect(await deleteTenant(db, bucket, tenant)).toEqual({
      emojiDeleted: 2,
      emojiIds: [expect.any(String), expect.any(String)],
    });
    expect(db.rows("SELECT external_id FROM tenants")).toEqual([{ external_id: "other" }]);
    expect(db.rows("SELECT tenant_id FROM custom_emoji")).toEqual([{ tenant_id: other.id }]);
    expect([...bucket.objects.keys()]).toEqual([expect.stringContaining(`/${other.id}/`)]);
  });
});
