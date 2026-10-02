import { PLANS, periodOf } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import type { ClassifyImageBody } from "../src/image.ts";
import type { SearchBody } from "../src/search.ts";
import { harness, image, jpeg, KEYS, reactions, search, seededStore } from "./fixtures.ts";

const NOW = Date.UTC(2026, 9, 2, 12);
const PERIOD = periodOf(NOW);
const FREE_LIMIT = PLANS.free.limits.semantic_calls;

async function setup(used = 0, metric: "semantic_calls" | "image_classifications" = "semantic_calls") {
  const store = await seededStore();
  if (used > 0) await store.addUsage([{ appId: "app_free", period: PERIOD, metric, count: used }]);
  return { store, h: harness({ store, now: () => NOW }) };
}

const keyed = (q: string, extra = "") => search(q, `&key=${KEYS.wildcard}${extra}`);

describe("metering", () => {
  it("counts searches, cache hits included, and flushes them to usage_monthly", async () => {
    const { store, h } = await setup();
    await h.call(keyed("lava eruption"));
    await h.ctx.settle();
    const hit = (await (await h.call(keyed("lava eruption"))).json()) as SearchBody;
    expect(hit.cached).toBe(true);
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", PERIOD, "semantic_calls")).toBe(2);
  });

  it("counts reactions as semantic calls and images as image classifications", async () => {
    const { store, h } = await setup();
    await h.call(reactions({ text: "we shipped it" }, `?key=${KEYS.wildcard}`));
    await h.call(image(jpeg(), {}, `?key=${KEYS.wildcard}`));
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", PERIOD, "semantic_calls")).toBe(1);
    expect(store.usageOf("app_free", PERIOD, "image_classifications")).toBe(1);
  });

  it("does not count degraded answers or anonymous calls", async () => {
    const { store, h } = await setup();
    await h.call(search("rocket"));
    h.env.AI = { run: async () => Promise.reject(new Error("offline")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await h.call(keyed("volcano"));
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(store.usage.size).toBe(0);
    warn.mockRestore();
  });
});

describe("over the plan limit", () => {
  it("returns empty semantic results with overLimit, without calling Workers AI", async () => {
    const { h } = await setup(FREE_LIMIT);
    const res = await h.call(keyed("lava eruption", "&mode=semantic"));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ results: [], overLimit: true, cached: false, degraded: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.ai).not.toHaveBeenCalled();
  });

  it("keeps alias results in hybrid mode and ignores cached semantic answers", async () => {
    const { h } = await setup(FREE_LIMIT);
    // An anonymous caller puts a semantic answer for the same query in the cache first.
    await h.call(search("ship it"));
    await h.ctx.settle();
    expect(h.cache.store.size).toBe(1);
    const body = (await (await h.call(keyed("ship it"))).json()) as SearchBody;
    expect(body).toMatchObject({ overLimit: true, cached: false });
    expect(body.results[0]).toMatchObject({ emoji: "🚀", source: "alias" });
    expect(body.results.every((r) => r.source === "alias")).toBe(true);
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("applies the limit of the key's plan", async () => {
    const { store, h } = await setup();
    await store.addUsage([{ appId: "app_pro", period: PERIOD, metric: "semantic_calls", count: FREE_LIMIT }]);
    const body = (await (await h.call(search("rocket", `&key=${KEYS.pro}`))).json()) as SearchBody;
    expect(body.overLimit).toBe(false);
  });

  it("also covers reactions and images, and does not count refused calls", async () => {
    const { store, h } = await setup(FREE_LIMIT);
    await store.addUsage([
      {
        appId: "app_free",
        period: PERIOD,
        metric: "image_classifications",
        count: PLANS.free.limits.image_classifications,
      },
    ]);
    const reaction = (await (
      await h.call(reactions({ text: "we shipped it" }, `?key=${KEYS.wildcard}`))
    ).json()) as SearchBody;
    expect(reaction.overLimit).toBe(true);
    expect(reaction.results.every((r) => r.source === "alias")).toBe(true);

    const img = (await (
      await h.call(image(jpeg(), {}, `?key=${KEYS.wildcard}`))
    ).json()) as ClassifyImageBody;
    expect(img).toEqual({
      caption: "",
      reaction: "",
      results: [],
      cached: false,
      degraded: false,
      overLimit: true,
    });
    expect(h.ai).not.toHaveBeenCalled();
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", PERIOD, "semantic_calls")).toBe(FREE_LIMIT);
  });

  it("starts serving again in the next month", async () => {
    let now = NOW;
    const store = await seededStore();
    await store.addUsage([
      { appId: "app_free", period: PERIOD, metric: "semantic_calls", count: FREE_LIMIT },
    ]);
    const h = harness({ store, now: () => now });
    expect(((await (await h.call(keyed("rocket"))).json()) as SearchBody).overLimit).toBe(true);
    now = Date.UTC(2026, 10, 1);
    expect(((await (await h.call(keyed("rocket"))).json()) as SearchBody).overLimit).toBe(false);
  });
});
