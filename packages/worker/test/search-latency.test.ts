/**
 * What a search waits for (src/search.ts, src/app.ts). Each test holds one read open and checks
 * that the answer, or the next step, does not wait for it: a serial path would hang here.
 */
import { periodOf } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import type { CustomEmojiReader } from "../src/custom-store.ts";
import type { SearchBody } from "../src/search.ts";
import type { Store } from "../src/store.ts";
import { catalog, harness, KEYS, keyedSearch, search, seededStore } from "./fixtures.ts";

/** A promise to resolve from outside. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const opened = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Fails instead of hanging when `promise` waits for something that never comes. */
const within = <T>(promise: Promise<T>, ms = 2_000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms)),
  ]);

const NOW = Date.UTC(2026, 9, 2, 12);
const keyed = (q: string, extra = "") => search(q, `&key=${KEYS.wildcard}${extra}`);

/** The seeded store, with the key's app marked as having (or not having) custom emoji. */
async function storeWith(overrides: Partial<Store>, hasCustomEmoji = false): Promise<Store> {
  const store = await seededStore();
  return {
    ...store,
    findKeyByHash: async (hash) => {
      const key = await store.findKeyByHash(hash);
      return key && { ...key, hasCustomEmoji };
    },
    ...overrides,
  };
}

/** Warms the shared cache with a development key's search. */
async function warm(h: ReturnType<typeof harness>, q: string) {
  await h.call(keyedSearch(q));
  await h.ctx.settle();
}

describe("search latency: what a request waits for", () => {
  it("looks up the edge cache while the key is checked", async () => {
    const matched = gate();
    const seeded = await seededStore();
    const store = await storeWith({
      // The key lookup finishes only after the cache lookup has started.
      findKeyByHash: async (hash) => {
        await matched.opened;
        return seeded.findKeyByHash(hash);
      },
    });
    const h = harness({ store });
    const match = h.cache.match.bind(h.cache);
    h.cache.match = (request) => {
      matched.open();
      return match(request);
    };
    expect((await within(h.call(keyed("lava eruption")))).status).toBe(200);
  });

  it("answers a cache hit without waiting for the account's usage, and counts it after", async () => {
    const usage = gate<Record<string, number>>();
    const memory = await seededStore();
    const store = await storeWith({
      // Only the keyed account's read is held; the development key that warms the cache reads at once.
      readAccountUsage: (account, period) =>
        account === "acc_free" ? usage.opened : memory.readAccountUsage(account, period),
      addUsage: memory.addUsage,
    });
    const h = harness({ store, now: () => NOW });
    await warm(h, "lava eruption");
    const hit = (await (await within(h.call(keyed("lava eruption")))).json()) as SearchBody;
    expect(hit.cached).toBe(true);
    usage.open({});
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(memory.usageOf("app_free", periodOf(NOW), "semantic_calls")).toBe(1);
  });

  it("starts the embedding of a miss while the account's usage is read", async () => {
    const usage = gate<Record<string, number>>();
    const store = await storeWith({ readAccountUsage: () => usage.opened });
    const h = harness({ store });
    const pending = h.call(keyed("lava eruption"));
    await vi.waitFor(() => expect(h.ai).toHaveBeenCalledTimes(1));
    usage.open({});
    const body = (await within(pending).then((res) => res.json())) as SearchBody;
    expect(body).toMatchObject({ overLimit: false, degraded: false });
    expect(body.results[0]).toMatchObject({ emoji: "🌋" });
  });

  it("counts the key check and the cache lookup in Server-Timing total", async () => {
    const h = harness();
    await warm(h, "lava eruption");
    const match = h.cache.match.bind(h.cache);
    h.cache.match = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return match(request);
    };
    const res = await h.call(keyedSearch("lava eruption"));
    const stages = Object.fromEntries(
      (res.headers.get("server-timing") ?? "").split(", ").map((stage) => {
        const [name, ms] = stage.split(";dur=");
        return [name, Number(ms)];
      }),
    );
    expect(stages.cache).toBeGreaterThanOrEqual(25);
    expect(stages.total).toBeGreaterThanOrEqual(stages.cache as number);
    expect(stages.total).toBeGreaterThanOrEqual(stages.auth as number);
  });

  it("answers a cache hit in a new isolate without building an alias engine", async () => {
    const warmer = harness();
    await warm(warmer, "lava eruption");
    const engine = vi.fn(catalog.engine);
    const aliasEngine = vi.fn(catalog.aliasEngine);
    const h = harness({ catalog: { ...catalog, engine, aliasEngine } });
    for (const [url, response] of warmer.cache.store) h.cache.store.set(url, response);
    const hit = (await (await h.call(keyedSearch("lava eruption"))).json()) as SearchBody;
    expect(hit.cached).toBe(true);
    expect(engine).not.toHaveBeenCalled();
    expect(aliasEngine).not.toHaveBeenCalled();
  });

  it("reads custom emoji only for an app that has some", async () => {
    const listUsable = vi.fn<CustomEmojiReader["listUsable"]>(async () => []);
    const reader: CustomEmojiReader = {
      listUsable,
      listTenantsWithEmoji: async () => [],
      find: async () => undefined,
    };
    const none = harness({ store: await storeWith({}, false), customEmoji: reader });
    await none.call(keyed("rocket"));
    expect(listUsable).not.toHaveBeenCalled();
    const some = harness({ store: await storeWith({}, true), customEmoji: reader });
    await some.call(keyed("rocket"));
    expect(listUsable).toHaveBeenCalledTimes(1);
  });
});
