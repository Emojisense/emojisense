import { describe, expect, it, vi } from "vitest";
import { Meter, type MeterOptions } from "../src/meter.ts";
import { createMemoryStore } from "../src/store.ts";
import { executionContext } from "./fixtures.ts";

const OCT = Date.UTC(2026, 9, 15);

function setup(start = OCT) {
  const clock = { now: start };
  const store = createMemoryStore();
  const meter = new Meter({ store, now: () => clock.now });
  const ctx = executionContext();
  return { clock, store, meter, ctx };
}

describe("Meter", () => {
  it("adds this isolate's calls on top of the stored monthly count", async () => {
    const { store, meter } = setup();
    await store.addUsage([{ appId: "app", period: "2026-10", metric: "semantic_calls", count: 40 }]);
    expect(await meter.count("app", "semantic_calls")).toBe(40);
    meter.add("app", "semantic_calls", true);
    meter.add("app", "semantic_calls", true);
    expect(await meter.count("app", "semantic_calls")).toBe(42);
    expect(await meter.count("app", "image_classifications")).toBe(0);
  });

  it("flushes the first call of a quiet isolate at once, then batches for 10 s", async () => {
    const { clock, store, meter, ctx } = setup();
    const write = vi.spyOn(store, "addUsage");
    meter.add("app", "semantic_calls", true);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(1);

    clock.now += 5_000;
    for (let i = 0; i < 10; i++) {
      meter.add("app", "semantic_calls", true);
      meter.flushIfDue(ctx);
    }
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(1);

    clock.now += 5_000;
    meter.add("app", "image_classifications", true);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).toEqual([
      { appId: "app", period: "2026-10", metric: "semantic_calls", count: 10 },
      { appId: "app", period: "2026-10", metric: "image_classifications", count: 1 },
    ]);
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(11);
  });

  it("flushes as soon as 100 calls are waiting", async () => {
    const { clock, store, meter, ctx } = setup();
    const write = vi.spyOn(store, "addUsage");
    meter.add("app", "semantic_calls", true);
    meter.flushIfDue(ctx);
    await ctx.settle();
    clock.now += 1_000;
    for (let i = 0; i < 99; i++) {
      meter.add("app", "semantic_calls", true);
      meter.flushIfDue(ctx);
    }
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(1);
    meter.add("app", "semantic_calls", true);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(101);
  });

  it("keeps calls pending when a flush fails, and writes them with the next one", async () => {
    const { clock, store, meter, ctx } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "addUsage").mockRejectedValueOnce(new Error("D1 busy"));
    meter.add("app", "semantic_calls", true);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(0);

    clock.now += 10_000;
    meter.add("app", "semantic_calls", true);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(2);
    warn.mockRestore();
  });

  it("re-reads the store after a minute, still counting unflushed calls", async () => {
    const { clock, store, meter } = setup();
    expect(await meter.count("app", "semantic_calls")).toBe(0);
    meter.add("app", "semantic_calls", true);
    // Another isolate flushed 500 calls meanwhile.
    await store.addUsage([{ appId: "app", period: "2026-10", metric: "semantic_calls", count: 500 }]);
    expect(await meter.count("app", "semantic_calls")).toBe(1);
    clock.now += 60_000;
    expect(await meter.count("app", "semantic_calls")).toBe(501);
  });

  it("starts each UTC month from that month's stored count", async () => {
    const { clock, store, meter, ctx } = setup(Date.UTC(2026, 9, 31, 23, 59, 59));
    meter.add("app", "semantic_calls", true);
    clock.now = Date.UTC(2026, 10, 1, 0, 0, 1);
    meter.add("app", "semantic_calls", true);
    expect(await meter.count("app", "semantic_calls")).toBe(1);
    await meter.flush();
    await ctx.settle();
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(1);
    expect(store.usageOf("app", "2026-11", "semantic_calls")).toBe(1);
  });

  it("keeps memory-only calls out of the store but in the count, across re-reads", async () => {
    const { clock, store, meter } = setup();
    meter.add("dev:0", "semantic_calls", false);
    await meter.flush();
    expect(store.usage.size).toBe(0);
    clock.now += 60_000;
    expect(await meter.count("dev:0", "semantic_calls")).toBe(1);
  });

  it("serves from local counts when the store cannot be read", async () => {
    const { store, meter } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "readUsage").mockRejectedValue(new Error("D1 unavailable"));
    meter.add("app", "semantic_calls", true);
    expect(await meter.count("app", "semantic_calls")).toBe(1);
    warn.mockRestore();
  });
});

describe("Meter flush reports (usage.threshold)", () => {
  function reporting() {
    const store = createMemoryStore();
    const onFlushed = vi.fn<NonNullable<MeterOptions["onFlushed"]>>();
    const meter = new Meter({ store, now: () => OCT, onFlushed });
    return { store, meter, onFlushed, ctx: executionContext() };
  }

  it("reports each account's new total, the calls added and the plan limit", async () => {
    const { store, meter, onFlushed, ctx } = reporting();
    await store.addUsage([{ appId: "app", period: "2026-10", metric: "semantic_calls", count: 78 }]);
    meter.add("app", "semantic_calls", true, 100);
    meter.add("app", "semantic_calls", true, 100);
    meter.add("app", "image_classifications", true, 10);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(onFlushed).toHaveBeenCalledTimes(1);
    // The memory store treats each app as its own account.
    expect(onFlushed.mock.calls[0]?.[0]).toEqual([
      { accountId: "app", period: "2026-10", metric: "semantic_calls", added: 2, total: 80, limit: 100 },
      { accountId: "app", period: "2026-10", metric: "image_classifications", added: 1, total: 1, limit: 10 },
    ]);
    expect(onFlushed.mock.calls[0]?.[1]).toBe(ctx);
  });

  it("adds up the calls of all apps of one account in a flush", async () => {
    const store = createMemoryStore();
    vi.spyOn(store, "addUsage").mockImplementation(async (deltas) =>
      deltas.map((d) => ({ ...d, accountId: "acc", accountCount: 90 })),
    );
    const onFlushed = vi.fn<NonNullable<MeterOptions["onFlushed"]>>();
    const meter = new Meter({ store, now: () => OCT, onFlushed });
    meter.add("app_1", "semantic_calls", true, 100);
    meter.add("app_2", "semantic_calls", true, 100);
    meter.add("app_2", "semantic_calls", true, 100);
    await meter.flush(executionContext());
    expect(onFlushed.mock.calls[0]?.[0]).toEqual([
      { accountId: "acc", period: "2026-10", metric: "semantic_calls", added: 3, total: 90, limit: 100 },
    ]);
  });

  it("reports nothing for a failed flush, and a failing report never re-counts calls", async () => {
    const { store, meter, onFlushed, ctx } = reporting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "addUsage").mockRejectedValueOnce(new Error("D1 busy"));
    meter.add("app", "semantic_calls", true, 100);
    meter.flushIfDue(ctx);
    await ctx.settle();
    expect(onFlushed).not.toHaveBeenCalled();

    onFlushed.mockImplementation(() => {
      throw new Error("boom");
    });
    await meter.flush(ctx);
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(1);
    await meter.flush(ctx);
    expect(store.usageOf("app", "2026-10", "semantic_calls")).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("usage_report_failed"));
    warn.mockRestore();
  });

  it("skips rows without a known limit (development callers)", async () => {
    const { meter, onFlushed, ctx } = reporting();
    meter.add("app", "semantic_calls", true);
    await meter.flush(ctx);
    expect(onFlushed).not.toHaveBeenCalled();
  });
});
