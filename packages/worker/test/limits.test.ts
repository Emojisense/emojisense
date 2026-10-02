import { PLANS, periodOf } from "@emojisense/platform";
import { describe, expect, it, vi } from "vitest";
import type { ClassifyImageBody } from "../src/image.ts";
import type { SearchBody } from "../src/search.ts";
import { harness, image, jpeg, KEYS, keyedSearch, reactions, search, seededStore } from "./fixtures.ts";

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
  it("returns empty semantic results with overLimit, and no model call once the usage is known", async () => {
    let now = NOW;
    const store = await seededStore();
    await store.addUsage([
      { appId: "app_free", period: PERIOD, metric: "semantic_calls", count: FREE_LIMIT },
    ]);
    const h = harness({ store, now: () => now });
    const res = await h.call(keyed("lava eruption", "&mode=semantic"));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ results: [], overLimit: true, cached: false, degraded: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The isolate's first search of the account embeds while its usage is read; the answer is
    // dropped. Later searches know the account is over the limit, also after the usage expires.
    expect(h.ai).toHaveBeenCalledTimes(1);
    await h.call(keyed("rocket launch", "&mode=semantic"));
    now += 10 * 60_000;
    expect(await (await h.call(keyed("volcano", "&mode=semantic"))).json()).toMatchObject({
      overLimit: true,
    });
    expect(h.ai).toHaveBeenCalledTimes(1);
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", PERIOD, "semantic_calls")).toBe(FREE_LIMIT);
  });

  it("keeps alias results in hybrid mode when nothing is cached", async () => {
    const { h } = await setup(FREE_LIMIT);
    const body = (await (await h.call(keyed("ship it"))).json()) as SearchBody;
    expect(body).toMatchObject({ overLimit: true, cached: false });
    expect(body.results[0]).toMatchObject({ emoji: "🚀", source: "alias" });
    expect(body.results.every((r) => r.source === "alias")).toBe(true);
    await h.call(keyed("ship it now"));
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("still serves the shared cache, without counting it", async () => {
    const { store, h } = await setup(FREE_LIMIT);
    // Another app (here a development key) puts the answer in the shared cache first.
    await h.call(keyedSearch("lava eruption"));
    await h.ctx.settle();
    const res = await h.call(keyed("lava eruption"));
    const body = (await res.json()) as SearchBody;
    expect(body).toMatchObject({ cached: true, overLimit: false, degraded: false });
    expect(body.results.some((r) => r.source === "semantic")).toBe(true);
    expect(h.ai).toHaveBeenCalledTimes(1);
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", PERIOD, "semantic_calls")).toBe(FREE_LIMIT);
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
      keywords: [],
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

describe("limits are per account", () => {
  const PRO = PLANS.pro.limits;
  let h: ReturnType<typeof harness>;
  const searchAs = async (key: string, q: string) =>
    (await (await h.call(search(q, `&key=${key}`))).json()) as SearchBody;

  /** A fresh isolate with this month's usage of the Pro account's two apps. */
  async function account(
    usage: { app_pro?: number; app_pro_2?: number },
    metric: "semantic_calls" | "image_classifications" = "semantic_calls",
  ) {
    const store = await seededStore();
    await store.addUsage(
      Object.entries(usage).map(([appId, count]) => ({ appId, period: PERIOD, metric, count })),
    );
    h = harness({ store, now: () => NOW });
    return store;
  }

  it("lets two apps of one account reach the limit together", async () => {
    const store = await account({ app_pro: PRO.semantic_calls / 2, app_pro_2: PRO.semantic_calls / 2 - 1 });
    const read = vi.spyOn(store, "readAccountUsage");
    // One call is left for the account, and the first app takes it.
    expect((await searchAs(KEYS.pro, "rocket")).overLimit).toBe(false);
    // Each app alone is far below the limit, but their account is at it.
    expect((await searchAs(KEYS.proSibling, "volcano")).overLimit).toBe(true);
    expect((await searchAs(KEYS.pro, "volcano")).overLimit).toBe(true);
    // One read of the account total for all three checks.
    expect(read).toHaveBeenCalledTimes(1);

    await h.ctx.settle();
    await h.app.meter?.flush();
    // Rows stay per app.
    expect(store.usageOf("app_pro", PERIOD, "semantic_calls")).toBe(PRO.semantic_calls / 2 + 1);
    expect(store.usageOf("app_pro_2", PERIOD, "semantic_calls")).toBe(PRO.semantic_calls / 2 - 1);
  });

  it("applies to image classifications too", async () => {
    await account({ app_pro: PRO.image_classifications - 1 }, "image_classifications");
    const classify = async (key: string) =>
      (await (await h.call(image(jpeg(), {}, `?key=${key}`))).json()) as ClassifyImageBody;
    expect((await classify(KEYS.proSibling)).overLimit).toBe(false);
    expect((await classify(KEYS.pro)).overLimit).toBe(true);
    expect((await classify(KEYS.proSibling)).overLimit).toBe(true);
  });

  it("leaves other accounts alone", async () => {
    const store = await account({ app_pro: PRO.semantic_calls });
    expect((await searchAs(KEYS.proSibling, "rocket")).overLimit).toBe(true);
    const free = await searchAs(KEYS.wildcard, "lava eruption");
    expect(free.overLimit).toBe(false);
    expect(free.results.some((r) => r.source === "semantic")).toBe(true);
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", PERIOD, "semantic_calls")).toBe(1);
  });

  it("still serves cached answers over the account limit, without counting them", async () => {
    const store = await account({ app_pro: PRO.semantic_calls });
    await h.call(keyedSearch("lava eruption"));
    await h.ctx.settle();
    const hit = await searchAs(KEYS.proSibling, "lava eruption");
    expect(hit).toMatchObject({ cached: true, overLimit: false, degraded: false });
    expect(hit.results.some((r) => r.source === "semantic")).toBe(true);
    await h.app.meter?.flush();
    expect(store.usageOf("app_pro_2", PERIOD, "semantic_calls")).toBe(0);
    expect(store.usageOf("app_pro", PERIOD, "semantic_calls")).toBe(PRO.semantic_calls);
  });
});
