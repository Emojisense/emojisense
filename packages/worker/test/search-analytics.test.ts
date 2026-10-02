import { dayOf, PLANS, periodOf } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import type { SearchBody } from "../src/search.ts";
import { harness, KEYS, reactions, search, seededStore } from "./fixtures.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const DAY = dayOf(NOW);

async function setup(env: Parameters<typeof harness>[0] = {}) {
  const store = await seededStore();
  const h = harness({ store, now: () => NOW, ...env });
  /** Writes whatever the isolate still holds, as the next due flush would. */
  const flush = async () => {
    await h.ctx.settle();
    await h.app.queryStats?.flush();
  };
  return { store, h, flush };
}

const keyed = (q: string, extra = "") => search(q, `&key=${KEYS.wildcard}${extra}`);

describe("search analytics", () => {
  it("counts each keyed search under its app, day and normalized query, cache hits included", async () => {
    const { store, h, flush } = await setup();
    await h.call(keyed("Lava  eruption!"));
    await h.ctx.settle();
    const hit = (await (await h.call(keyed("lava eruption"))).json()) as SearchBody;
    expect(hit.cached).toBe(true);
    await flush();
    expect([...store.queries.values()]).toEqual([
      { appId: "app_free", day: DAY, query: "lava eruption", searches: 2, misses: 0 },
    ]);
  });

  it("counts a search with no results as a miss", async () => {
    const { store, h, flush } = await setup();
    h.env.AI = { run: async () => Promise.reject(new Error("offline")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty = (await (await h.call(keyed("qwxzv"))).json()) as SearchBody;
    const found = (await (await h.call(keyed("rocket"))).json()) as SearchBody;
    expect(empty.results).toEqual([]);
    expect(found.results.length).toBeGreaterThan(0);
    await flush();
    expect(store.queryCountOf("app_free", DAY, "qwxzv")).toMatchObject({ searches: 1, misses: 1 });
    expect(store.queryCountOf("app_free", DAY, "rocket")).toMatchObject({ searches: 1, misses: 0 });
    warn.mockRestore();
  });

  it("counts searches over the plan limit by what the caller got", async () => {
    const { store, h, flush } = await setup();
    const limit = PLANS.free.limits.semantic_calls;
    await store.addUsage([
      { appId: "app_free", period: periodOf(NOW), metric: "semantic_calls", count: limit },
    ]);
    await h.call(keyed("rocket"));
    await h.call(keyed("rocket", "&mode=semantic"));
    await flush();
    expect(store.queryCountOf("app_free", DAY, "rocket")).toMatchObject({ searches: 2, misses: 1 });
  });

  it("never counts anonymous calls", async () => {
    const { store, h, flush } = await setup();
    await h.call(search("rocket"));
    await h.call(search("rocket"));
    await flush();
    expect(h.app.queryStats?.pendingSearches).toBe(0);
    expect(store.queries.size).toBe(0);
  });

  it("never counts development keys, which have no app to attach the rows to", async () => {
    const { store, h, flush } = await setup({ env: { DEV_KEYS: "pk_test" } });
    await h.call(search("rocket", "&key=pk_test"));
    await flush();
    expect(store.queries.size).toBe(0);
  });

  it("never counts reaction text", async () => {
    const { store, h, flush } = await setup();
    await h.call(reactions({ text: "we shipped it" }, `?key=${KEYS.wildcard}`));
    await flush();
    expect(store.queries.size).toBe(0);
  });
});
