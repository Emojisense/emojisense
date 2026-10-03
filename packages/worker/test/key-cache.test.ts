import { hashKey } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import { KEY_CACHE_STALE_MS, KEY_CACHE_TTL_MS } from "../src/config.ts";
import type { RateLimiter } from "../src/env.ts";
import { KeyCache } from "../src/key-cache.ts";
import { apiKey, harness, image, jpeg, KEYS, search, seededStore } from "./fixtures.ts";

const T0 = Date.UTC(2026, 9, 3);
const KEY = apiKey({ appId: "app_a", accountId: "acc_a" });

describe("KeyCache", () => {
  it("serves an entry fresh for the TTL, stale for the stale window, then drops it", () => {
    let now = T0;
    const cache = new KeyCache({ now: () => now, ttlMs: 1_000, staleMs: 2_000 });
    cache.set("h", KEY);
    expect(cache.get("h")).toEqual({ key: KEY, fresh: true });
    now = T0 + 999;
    expect(cache.get("h")?.fresh).toBe(true);
    now = T0 + 1_000;
    expect(cache.get("h")).toEqual({ key: KEY, fresh: false });
    now = T0 + 2_999;
    expect(cache.get("h")?.fresh).toBe(false);
    now = T0 + 3_000;
    expect(cache.get("h")).toBeUndefined();
    expect(cache.size).toBe(0);
    // Dropped for good: a clock that steps back does not bring it back.
    now = T0;
    expect(cache.get("h")).toBeUndefined();
  });

  it("caches unknown keys, with the same lifetime", () => {
    let now = T0;
    const cache = new KeyCache({ now: () => now, ttlMs: 1_000, staleMs: 1_000 });
    cache.set("unknown", undefined);
    expect(cache.get("unknown")).toEqual({ key: undefined, fresh: true });
    now = T0 + 2_000;
    expect(cache.get("unknown")).toBeUndefined();
  });

  it("drops the entries past the stale window when a key is stored, without reading them", () => {
    let now = T0;
    const cache = new KeyCache({ now: () => now, ttlMs: 1_000, staleMs: 1_000 });
    cache.set("a", KEY);
    now = T0 + 500;
    cache.set("b", KEY);
    now = T0 + 2_000;
    cache.set("c", KEY);
    expect(cache.size).toBe(2);
    now = T0 + 2_500;
    cache.set("d", KEY);
    expect(cache.size).toBe(2);
    expect(cache.get("c")?.fresh).toBe(true);
    expect(cache.get("d")?.fresh).toBe(true);
  });

  it("restarts an entry's lifetime when it is stored again", () => {
    let now = T0;
    const cache = new KeyCache({ now: () => now, ttlMs: 1_000, staleMs: 1_000 });
    cache.set("a", KEY);
    now = T0 + 1_500;
    cache.set("a", { ...KEY, revoked: true });
    now = T0 + 2_200;
    expect(cache.get("a")).toEqual({ key: { ...KEY, revoked: true }, fresh: true });
  });

  it("keeps at most maxEntries, dropping the oldest", () => {
    const cache = new KeyCache({ now: () => T0, maxEntries: 2 });
    cache.set("a", KEY);
    cache.set("b", KEY);
    cache.set("c", KEY);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });
});

describe("a revoked key whose cache entry is too old", () => {
  const MAX_AGE = KEY_CACHE_TTL_MS + KEY_CACHE_STALE_MS;

  it("fails closed with 429 when its IP's miss budget is spent", async () => {
    let now = T0;
    const store = await seededStore();
    let missesLeft = 1;
    const misses = vi.fn<RateLimiter["limit"]>(async () => ({ success: missesLeft-- > 0 }));
    const h = harness({ store, now: () => now, env: { KEY_MISS_LIMITER: { limit: misses } } });
    const call = () => h.call(search("rocket", `&key=${KEYS.wildcard}`));
    expect((await call()).status).toBe(200);

    // Revoked in the dashboard; the caller then spends its own miss budget so no new read happens.
    const row = store.keys.get(await hashKey(KEYS.wildcard));
    if (row) row.revoked = true;
    now = T0 + MAX_AGE - 1;
    expect((await call()).status).toBe(200);
    now = T0 + MAX_AGE;
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    now = T0 + MAX_AGE + 60_000;
    expect((await call()).status).toBe(429);

    // With budget again, the read happens and the revocation is seen.
    missesLeft = 1;
    expect((await call()).status).toBe(401);
  });

  it("is not trusted while D1 fails: search serves anonymous, key routes answer 503", async () => {
    let now = T0;
    const store = await seededStore();
    const anon = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const keyed = vi.fn<RateLimiter["limit"]>(async () => ({ success: true }));
    const h = harness({
      store,
      now: () => now,
      env: { ANON_LIMITER: { limit: anon }, SEARCH_LIMITER: { limit: keyed } },
    });
    expect((await h.call(search("rocket", `&key=${KEYS.wildcard}`))).status).toBe(200);
    vi.spyOn(store, "findKeyByHash").mockRejectedValue(new Error("D1 unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    now = T0 + MAX_AGE - 1;
    expect((await h.call(search("rocket", `&key=${KEYS.wildcard}`))).status).toBe(200);
    expect(keyed).toHaveBeenCalledTimes(2);
    expect(anon).not.toHaveBeenCalled();

    now = T0 + MAX_AGE;
    expect((await h.call(search("rocket", `&key=${KEYS.wildcard}`))).status).toBe(200);
    expect(keyed).toHaveBeenCalledTimes(2);
    expect(anon).toHaveBeenCalledTimes(1);
    const classify = await h.call(image(jpeg(), {}, `?key=${KEYS.wildcard}`));
    expect(classify.status).toBe(503);
    expect(await classify.json()).toEqual({ error: "key check temporarily unavailable" });
    warn.mockRestore();
  });
});
