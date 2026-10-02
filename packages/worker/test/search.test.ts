import { describe, expect, it, vi } from "vitest";
import type { SearchBody } from "../src/search.ts";
import { API, EMBEDDING_MODEL, harness, search } from "./fixtures.ts";

describe("GET /v1/search", () => {
  it("fuses alias and semantic results and formats the query for the model", async () => {
    const h = harness();
    const res = await h.call(search("Lava eruption!!"));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ query: "lava eruption", cached: false, degraded: false, overLimit: false });
    expect(body.results[0]).toMatchObject({ emoji: "🌋", source: "semantic" });
    expect(h.ai).toHaveBeenCalledWith(EMBEDDING_MODEL, {
      text: ["task: search result | query: lava eruption"],
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("server-timing")).toMatch(/^embed;dur=\d+, total;dur=\d+$/);
  });

  it("keeps confident alias hits on top in hybrid mode", async () => {
    const body = (await (await harness().call(search("jurassic park"))).json()) as SearchBody;
    expect(body.results[0]).toMatchObject({ emoji: "🦖", source: "alias" });
  });

  it("returns semantic results only in semantic mode", async () => {
    const body = (await (
      await harness().call(search("jurassic park", "&mode=semantic"))
    ).json()) as SearchBody;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.source === "semantic")).toBe(true);
  });

  it("serves the second identical query from cache, ignoring the key and raw spelling", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_test" } });
    await h.call(search("Lava  eruption", "&key=pk_test"));
    await h.ctx.settle();
    const second = await h.call(search("lava eruption"));
    expect(((await second.json()) as SearchBody).cached).toBe(true);
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("degrades to alias-only results when Workers AI fails, and does not cache them", async () => {
    const h = harness();
    h.env.AI = { run: async () => Promise.reject(new Error("not logged in")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await h.call(search("rocket"));
    await h.ctx.settle();
    const body = (await res.json()) as SearchBody;
    expect(body.degraded).toBe(true);
    expect(body.results[0]?.emoji).toBe("🚀");
    expect(h.cache.store.size).toBe(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
    warn.mockRestore();
  });

  it("rejects empty queries, wrong methods, unknown paths and rate-limited callers", async () => {
    const h = harness();
    expect((await h.call(search("🚀"))).status).toBe(400);
    expect((await h.call(search("rocket", "", { method: "POST" }))).status).toBe(405);
    expect((await h.call(new Request(`${API}/v2/nope`))).status).toBe(404);
    h.env.ANON_LIMITER = { limit: async () => ({ success: false }) };
    const limited = await h.call(search("rocket"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("answers CORS preflights for POST bodies but never allows the Authorization header", async () => {
    const res = await harness().call(new Request(`${API}/v1/suggest-reactions`, { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("X-Image-Hash");
    expect(res.headers.get("access-control-allow-headers")).not.toMatch(/authorization/i);
  });

  it("reports health without touching keys", async () => {
    const res = await harness().call(new Request(`${API}/v1/health`));
    expect(await res.json()).toEqual({
      ok: true,
      packVersion: "test",
      model: "embeddinggemma@8",
      semantic: true,
    });
  });
});

describe("search analytics", () => {
  it("logs the normalized text of every search that reaches the Worker, cache hits included", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_test" } });
    await h.call(search("Rocket!", "&key=pk_test", { headers: { "cf-connecting-ip": "203.0.113.9" } }));
    await h.ctx.settle();
    await h.call(search("rocket"));
    await h.call(search("lava eruption", "&mode=semantic"));
    const points = h.events.mock.calls.map(([point]) => point);
    expect(points.map((p) => p.blobs)).toEqual([
      ["rocket", "en", "hybrid", "miss", "search"],
      ["rocket", "en", "hybrid", "hit", "search"],
      ["lava eruption", "en", "semantic", "miss", "search"],
    ]);
    expect(points[0].indexes).toEqual(["test:embeddinggemma@8"]);
    const logged = JSON.stringify(points);
    expect(logged).not.toContain("pk_test");
    expect(logged).not.toContain("203.0.113.9");
  });

  it("never lets an analytics failure break a search", async () => {
    const h = harness({
      env: {
        EVENTS: {
          writeDataPoint: () => {
            throw new Error("dataset unavailable");
          },
        },
      },
    });
    expect((await h.call(search("rocket"))).status).toBe(200);
  });
});
