import { hashKey } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import { parseDevKeys } from "../src/auth.ts";
import type { RateLimiter } from "../src/env.ts";
import { ALLOWED_ORIGIN, harness, KEYS, search, seededStore } from "./fixtures.ts";

const withKey = (key: string, origin?: string) =>
  search("rocket", `&key=${key}`, origin ? { headers: { Origin: origin } } : undefined);
const withBearer = (key: string, headers: Record<string, string> = {}) =>
  search("rocket", "", { headers: { Authorization: `Bearer ${key}`, ...headers } });

describe("publishable keys", () => {
  it("accept requests from an allowed origin and refuse other origins", async () => {
    const h = harness({ store: await seededStore() });
    expect((await h.call(withKey(KEYS.publishable, ALLOWED_ORIGIN))).status).toBe(200);
    const denied = await h.call(withKey(KEYS.publishable, "https://evil.example"));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "origin not allowed for this key" });
    // A key bound to origins is a browser key: no Origin header is refused too.
    expect((await h.call(withKey(KEYS.publishable))).status).toBe(403);
  });

  it("allow any origin when the key has no origin list", async () => {
    const h = harness({ store: await seededStore() });
    expect((await h.call(withKey(KEYS.wildcard, "https://anywhere.example"))).status).toBe(200);
    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(200);
  });

  it("reject unknown and revoked keys with 401", async () => {
    const h = harness({ store: await seededStore() });
    expect((await h.call(withKey("pk_live_doesnotexist"))).status).toBe(401);
    const revoked = await h.call(withKey(KEYS.revoked));
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({ error: "unknown or revoked key" });
  });
});

describe("secret keys", () => {
  it("are accepted as a Bearer token from servers", async () => {
    const h = harness({ store: await seededStore() });
    expect((await h.call(withBearer(KEYS.secret))).status).toBe(200);
  });

  it("are refused together with an Origin header (sent from a browser)", async () => {
    const h = harness({ store: await seededStore() });
    expect((await h.call(withBearer(KEYS.secret, { Origin: ALLOWED_ORIGIN }))).status).toBe(403);
  });

  it("are refused in the URL, before any lookup", async () => {
    const store = await seededStore();
    const lookup = vi.spyOn(store, "findKeyByHash");
    const res = await harness({ store }).call(withKey(KEYS.secret));
    expect(res.status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("need the Bearer scheme", async () => {
    const h = harness({ store: await seededStore() });
    const res = await h.call(search("rocket", "", { headers: { Authorization: `Basic ${KEYS.secret}` } }));
    expect(res.status).toBe(401);
  });
});

describe("key cache", () => {
  it("reads each key from the store once per minute, unknown keys included", async () => {
    let now = Date.UTC(2026, 9, 2);
    const store = await seededStore();
    const lookup = vi.spyOn(store, "findKeyByHash");
    const h = harness({ store, now: () => now });
    await h.call(withKey(KEYS.wildcard));
    await h.call(withKey(KEYS.wildcard));
    await h.call(withKey("pk_live_unknown"));
    await h.call(withKey("pk_live_unknown"));
    expect(lookup).toHaveBeenCalledTimes(2);

    // Revoked in the dashboard: the isolate notices when its cache entry expires.
    const entry = store.keys.get(await hashKey(KEYS.wildcard));
    if (entry) entry.revoked = true;
    now += 30_000;
    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(200);
    now += 31_000;
    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(401);
  });

  it("serves a stale entry when the store fails, and anonymous when nothing is cached", async () => {
    let now = Date.UTC(2026, 9, 2);
    const store = await seededStore();
    const anon = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const keyed = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const h = harness({
      store,
      now: () => now,
      env: { ANON_LIMITER: { limit: anon }, SEARCH_LIMITER: { limit: keyed } },
    });
    await h.call(withKey(KEYS.wildcard));
    vi.spyOn(store, "findKeyByHash").mockRejectedValue(new Error("D1 unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    now += 120_000;

    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(200);
    expect(keyed).toHaveBeenCalledTimes(2);
    expect((await h.call(withKey(KEYS.pro))).status).toBe(200);
    expect(anon).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("rate limits", () => {
  it("use the key id and IP for keys and the IP alone for anonymous callers, never the raw key", async () => {
    const anon = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const keyed = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const h = harness({
      store: await seededStore(),
      env: { ANON_LIMITER: { limit: anon }, SEARCH_LIMITER: { limit: keyed } },
    });
    const ip = { "cf-connecting-ip": "198.51.100.7" };
    await h.call(search("rocket", `&key=${KEYS.wildcard}`, { headers: ip }));
    await h.call(search("rocket", "", { headers: ip }));
    expect(keyed).toHaveBeenCalledWith({ key: "key_any:198.51.100.7" });
    expect(anon).toHaveBeenCalledWith({ key: "anon:198.51.100.7" });
  });
});

describe("dev keys", () => {
  it("parse `key` and `key:plan` entries, defaulting to a publishable free key", () => {
    const keys = parseDevKeys(" pk_demo , sk_live_local:pro,, pk_x:unknown");
    expect([...keys.keys()]).toEqual(["pk_demo", "sk_live_local", "pk_x"]);
    expect(keys.get("pk_demo")).toMatchObject({ kind: "publishable", plan: "free", allowedOrigins: [] });
    expect(keys.get("sk_live_local")).toMatchObject({ kind: "secret", plan: "pro" });
    expect(keys.get("pk_x")?.plan).toBe("free");
  });

  it("work without a store and keep the secret-key rules", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_demo,sk_live_local" } });
    expect((await h.call(withKey("pk_demo", "http://localhost:5173"))).status).toBe(200);
    expect((await h.call(withBearer("sk_live_local"))).status).toBe(200);
    expect((await h.call(withBearer("sk_live_local", { Origin: "http://localhost:5173" }))).status).toBe(403);
    expect((await h.call(withKey("pk_other"))).status).toBe(401);
  });

  it("are metered in memory only, never written to usage_monthly", async () => {
    const store = await seededStore();
    const h = harness({ store, env: { DEV_KEYS: "pk_demo" } });
    await h.call(withKey("pk_demo"));
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(store.usage.size).toBe(0);
    expect(await h.app.meter?.count("dev:0", "semantic_calls")).toBe(1);
  });
});
