import { hashKey } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import { parseDevKeys } from "../src/auth.ts";
import type { RateLimiter } from "../src/env.ts";
import { createMemoryStore } from "../src/store.ts";
import { ALLOWED_ORIGIN, apiKey, harness, KEYS, search, seededStore } from "./fixtures.ts";

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

describe("key environments", () => {
  const owner = { appId: "app_1", accountId: "acc_1" };

  it("pause a dev or staging key while the plan does not include it, with the plan that does", async () => {
    const cases = [
      ["free", "dev", 402, "solo"],
      ["solo", "staging", 402, "pro"],
      ["solo", "dev", 200, undefined],
      ["free", "prod", 200, undefined],
    ] as const;
    for (const [plan, environment, status, required] of cases) {
      const store = createMemoryStore({
        [await hashKey(KEYS.wildcard)]: apiKey(owner, { plan, environment }),
      });
      const response = await harness({ store }).call(withKey(KEYS.wildcard));
      expect(response.status, `${environment} key on ${plan}`).toBe(status);
      if (required) expect(await response.json()).toMatchObject({ error: "plan_required", plan: required });
    }
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

describe("key lookups that miss the cache", () => {
  const limiterAllowing = (n: number) => {
    let left = n;
    return vi.fn<RateLimiter["limit"]>(async () => ({ success: left-- > 0 }));
  };

  it("are rate limited per IP before the D1 read, so random keys cannot flood it", async () => {
    const store = await seededStore();
    const lookup = vi.spyOn(store, "findKeyByHash");
    const misses = limiterAllowing(2);
    const h = harness({ store, env: { KEY_MISS_LIMITER: { limit: misses } } });
    const ip = { headers: { "cf-connecting-ip": "203.0.113.9" } };
    expect((await h.call(search("rocket", "&key=pk_live_random1", ip))).status).toBe(401);
    expect((await h.call(search("rocket", "&key=pk_live_random2", ip))).status).toBe(401);
    const limited = await h.call(search("rocket", "&key=pk_live_random3", ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(misses).toHaveBeenCalledWith({ key: "keymiss:203.0.113.9" });
    expect(JSON.stringify(misses.mock.calls)).not.toContain("pk_live");
  });

  it("are not counted for cached keys, and a stale entry still serves when limited", async () => {
    let now = Date.UTC(2026, 9, 2);
    const store = await seededStore();
    const misses = limiterAllowing(1);
    const h = harness({ store, now: () => now, env: { KEY_MISS_LIMITER: { limit: misses } } });
    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(200);
    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(200);
    expect(misses).toHaveBeenCalledTimes(1);
    now += 120_000;
    // The entry expired and the limiter refuses a new read: the known key keeps working.
    expect((await h.call(withKey(KEYS.wildcard))).status).toBe(200);
    expect((await h.call(withKey(KEYS.pro))).status).toBe(429);
  });

  it("need no limiter for development keys", async () => {
    const misses = limiterAllowing(0);
    const h = harness({ env: { DEV_KEYS: "pk_demo", KEY_MISS_LIMITER: { limit: misses } } });
    expect((await h.call(withKey("pk_demo"))).status).toBe(200);
    expect(misses).not.toHaveBeenCalled();
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

  it("give publishable-key calls from our own pages a per-IP budget of their own", async () => {
    const site = vi.fn<RateLimiter["limit"]>(async () => ({ success: false }));
    const keyed = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const h = harness({
      store: await seededStore(),
      env: {
        SITE_LIMITER: { limit: site },
        SEARCH_LIMITER: { limit: keyed },
        FIRST_PARTY_ORIGINS: "https://emojisense.example, https://app.emojisense.example",
      },
    });
    const from = (origin: string) => ({ headers: { Origin: origin, "cf-connecting-ip": "198.51.100.7" } });
    const fromSite = await h.call(
      search("rocket", `&key=${KEYS.wildcard}`, from("https://emojisense.example")),
    );
    expect(fromSite.status).toBe(429);
    expect(site).toHaveBeenCalledWith({ key: "site:198.51.100.7" });
    expect(keyed).not.toHaveBeenCalled();
    await h.call(search("rocket", `&key=${KEYS.wildcard}`, from("https://app.emojisense.example")));
    expect(site).toHaveBeenCalledTimes(2);

    // A customer's page and a server's secret key keep the per-key limiter.
    const customer = await h.call(search("rocket", `&key=${KEYS.wildcard}`, from("https://shop.example")));
    expect(customer.status).toBe(200);
    expect((await h.call(withBearer(KEYS.secret))).status).toBe(200);
    expect(keyed.mock.calls.map(([call]) => call.key)).toEqual(["key_any:198.51.100.7", "key_sec:local"]);
    expect(site).toHaveBeenCalledTimes(2);
  });

  it("keep the per-key limiter for our own pages when SITE_LIMITER is not bound", async () => {
    const keyed = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const h = harness({
      store: await seededStore(),
      env: { SEARCH_LIMITER: { limit: keyed }, FIRST_PARTY_ORIGINS: "https://emojisense.example" },
    });
    await h.call(withKey(KEYS.wildcard, "https://emojisense.example"));
    expect(keyed).toHaveBeenCalledWith({ key: "key_any:local" });
  });
});

describe("dev keys", () => {
  it("parse `key` and `key:plan` entries, defaulting to a publishable free key", () => {
    const keys = parseDevKeys(" pk_demo , sk_live_local:pro,, pk_x:unknown");
    expect([...keys.keys()]).toEqual(["pk_demo", "sk_live_local", "pk_x"]);
    // Each dev key is its own app and its own account (no database rows).
    expect(keys.get("pk_demo")).toMatchObject({
      appId: "dev:0",
      accountId: "dev:0",
      kind: "publishable",
      plan: "free",
      allowedOrigins: [],
    });
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
    expect(await h.app.meter?.accountCount("dev:0", "semantic_calls")).toBe(1);
  });
});

describe("plain http", () => {
  const overHttp = (host: string) =>
    new Request(`http://${host}/v1/search?q=rocket&key=${KEYS.publishable}`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

  it.each(["production", "staging"])(
    "is refused by the %s API before the key is looked up",
    async (environment) => {
      const store = await seededStore();
      const lookup = vi.spyOn(store, "findKeyByHash");
      const h = harness({ store, env: { ENVIRONMENT: environment } });
      const res = await h.call(overHttp("api.emojisense.example"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "use https://api.emojisense.example: plain http would send keys and text unencrypted",
      });
      expect(lookup).not.toHaveBeenCalled();
      expect((await h.call(new Request("http://api.emojisense.example/v1/health"))).status).toBe(403);
    },
  );

  it("is still served over https, on localhost and in local development", async () => {
    const store = await seededStore();
    const production = harness({ store, env: { ENVIRONMENT: "production" } });
    expect((await production.call(withKey(KEYS.publishable, ALLOWED_ORIGIN))).status).toBe(200);
    expect((await production.call(overHttp("localhost:8788"))).status).toBe(200);
    expect((await production.call(overHttp("127.0.0.1:8788"))).status).toBe(200);
    // A phone on the LAN reaching `wrangler dev`.
    for (const env of [{}, { ENVIRONMENT: "development" }]) {
      expect((await harness({ store, env }).call(overHttp("192.168.1.20:8788"))).status).toBe(200);
    }
  });
});
