import { getModel } from "@emojisense/data/models";
import { DEFAULT_SEMANTIC_CALIBRATION } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import type { SearchBody } from "../src/search.ts";
import type { Catalog } from "../src/semantic.ts";
import type { Store } from "../src/store.ts";
import { API, catalog, EMBEDDING_MODEL, harness, keyedSearch, search } from "./fixtures.ts";

describe("GET /v1/search", () => {
  it("fuses alias and semantic results and embeds the query with its accents and punctuation", async () => {
    const h = harness();
    const res = await h.call(keyedSearch("  Lavá   eruption!! "));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ query: "lava eruption", cached: false, degraded: false, overLimit: false });
    expect(body.results[0]).toMatchObject({ emoji: "🌋", source: "semantic" });
    expect(h.ai).toHaveBeenCalledWith(EMBEDDING_MODEL, {
      text: ["lavá eruption!!"],
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const stages = (res.headers.get("server-timing") ?? "").split(", ").map((s) => s.split(";")[0]);
    expect(stages.sort()).toEqual(
      ["auth", "cache", "custom", "usage", "rank", "embed", "vectors", "locale", "total"].sort(),
    );
    expect(res.headers.get("server-timing")).toMatch(/(^|, )embed;dur=\d+(, |$)/);
  });

  it("wraps the query in the model's template when it has one", async () => {
    const gemma: Catalog = {
      ...catalog,
      config: {
        ...catalog.config,
        modelKey: "embeddinggemma",
        modelId: "@cf/google/embeddinggemma-300m",
        queryTemplate: "task: search result | query: {q}",
      },
      model: getModel("embeddinggemma"),
    };
    const h = harness({ catalog: gemma });
    await h.call(keyedSearch("Lava eruption"));
    expect(h.ai).toHaveBeenCalledWith("@cf/google/embeddinggemma-300m", {
      text: ["task: search result | query: lava eruption"],
    });
  });

  it("keeps confident alias hits on top in hybrid mode", async () => {
    const body = (await (await harness().call(search("jurassic park"))).json()) as SearchBody;
    expect(body.results[0]).toMatchObject({ emoji: "🦖", source: "alias" });
  });

  it("ranks the same candidates whatever the limit, then cuts to it", async () => {
    const h = harness();
    const ids = async (limit: number) =>
      (
        (await (await h.call(keyedSearch("lava eruption", `&limit=${limit}`))).json()) as SearchBody
      ).results.map((r) => r.id);
    const all = await ids(24);
    expect(await ids(2)).toEqual(all.slice(0, 2));
  });

  it("returns semantic results only in semantic mode", async () => {
    const body = (await (
      await harness().call(keyedSearch("jurassic park", "&mode=semantic"))
    ).json()) as SearchBody;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.source === "semantic")).toBe(true);
    // The client fuses with the model's own calibration (core session.ts).
    expect(body.calibration).toEqual(DEFAULT_SEMANTIC_CALIBRATION);
  });

  it("says how well the tiers understood the query, in both modes", async () => {
    const body = async (res: Response) => (await res.json()) as SearchBody;
    const understood = await body(await harness().call(keyedSearch("jurassic park")));
    expect(understood).toMatchObject({ unsure: false });
    expect(understood.confidence).toBeGreaterThan(0.6);
    expect(understood).not.toHaveProperty("concept");
    // The fake embedding lands on no fixture row: a flat, low semantic list.
    for (const mode of ["", "&mode=semantic"]) {
      const unsure = await body(await harness({ embedTo: 4 }).call(keyedSearch("kendrick lamar", mode)));
      expect(unsure).toMatchObject({ unsure: true });
      expect(unsure.confidence).toBeLessThan(0.6);
      expect(unsure.results.every((r) => r.source === "semantic" || r.source === "alias")).toBe(true);
    }
  });

  it("serves the second identical query of an account from cache, ignoring case and spacing", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_test" } });
    await h.call(search("Lava  eruption", "&key=pk_test"));
    await h.ctx.settle();
    const second = await h.call(search("LAVA eruption", "&key=pk_test"));
    expect(((await second.json()) as SearchBody).cached).toBe(true);
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("never answers one account from another account's cache entries", async () => {
    // Two development keys: two accounts. A hit would tell the second that the first searched it.
    const h = harness({ env: { DEV_KEYS: "pk_test,pk_other" } });
    await h.call(search("lava eruption", "&key=pk_test"));
    await h.ctx.settle();
    const res = await h.call(search("lava eruption", "&key=pk_other"));
    expect(((await res.json()) as SearchBody).cached).toBe(false);
    expect(res.headers.get("server-timing")).toMatch(/(^|, )embed;dur=/);
    expect(h.ai).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by account and the data's content hash, never by the key, user or origin", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_test" } });
    await h.call(
      search("lava eruption", "&key=pk_test", {
        headers: { origin: "https://app.example.com", "cf-connecting-ip": "203.0.113.9" },
      }),
    );
    await h.ctx.settle();
    expect(h.cache.puts).toHaveLength(1);
    const key = new URL(h.cache.puts[0] as string);
    expect(Object.fromEntries(key.searchParams)).toEqual({
      q: "lava eruption",
      locale: "en",
      limit: "24",
      mode: "hybrid",
      v: "test:bge-m3@8",
      c: "c0ffee",
      account: "dev:0",
    });

    const hotfix = harness({ catalog: { ...catalog, config: { ...catalog.config, contentHash: "beef" } } });
    hotfix.cache.store.set(key.href, h.cache.store.get(key.href) as Response);
    const fresh = await hotfix.call(keyedSearch("lava eruption"));
    expect(((await fresh.json()) as SearchBody).cached).toBe(false);
  });

  it("keys the cache by the embedded text, so an accent is a different answer", async () => {
    const h = harness();
    await h.call(keyedSearch("lavá"));
    await h.ctx.settle();
    const second = await h.call(keyedSearch("lava"));
    expect(((await second.json()) as SearchBody).cached).toBe(false);
    expect(h.ai).toHaveBeenCalledTimes(2);
  });

  it("degrades to alias-only results when Workers AI fails, and does not cache them", async () => {
    const h = harness();
    h.env.AI = { run: async () => Promise.reject(new Error("not logged in")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await h.call(keyedSearch("rocket"));
    await h.ctx.settle();
    const body = (await res.json()) as SearchBody;
    expect(body.degraded).toBe(true);
    expect(body.results[0]?.emoji).toBe("🚀");
    expect(h.cache.store.size).toBe(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
    warn.mockRestore();
  });

  it("logs only the error type when Workers AI fails, never the query", async () => {
    const h = harness();
    h.env.AI = { run: async () => Promise.reject(new TypeError("model failed on: rocket launch")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await h.call(keyedSearch("rocket launch"));
    await h.ctx.settle();
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "semantic_unavailable", error: "TypeError" }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("rocket");
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
      model: "bge-m3@8",
      semantic: true,
    });
  });
});

describe("anonymous search", () => {
  it("answers a cache miss with aliases only, never calls Workers AI and never caches it", async () => {
    const h = harness();
    const res = await h.call(search("ship it"));
    await h.ctx.settle();
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ cached: false, degraded: false, overLimit: true, aliasLocale: "en" });
    expect(body.results[0]).toMatchObject({ emoji: "🚀", source: "alias" });
    expect(body.results.every((r) => r.source === "alias")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.cache.puts).toEqual([]);
  });

  it("gets no results in semantic mode on a miss", async () => {
    const h = harness();
    const body = (await (await h.call(search("lava eruption", "&mode=semantic"))).json()) as SearchBody;
    expect(body).toMatchObject({ results: [], overLimit: true, cached: false });
    expect(h.ai).not.toHaveBeenCalled();
  });

  it("is never served from the cache that keyed callers fill", async () => {
    const h = harness();
    await h.call(keyedSearch("lava eruption"));
    await h.ctx.settle();
    const res = await h.call(search("lava eruption"));
    const body = (await res.json()) as SearchBody;
    expect(body).toMatchObject({ cached: false, overLimit: true });
    expect(body.results.every((r) => r.source === "alias")).toBe(true);
    expect(res.headers.get("server-timing")).not.toMatch(/(^|, )cache;dur=/);
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("applies when the key store is down and the key is not cached", async () => {
    const store = { findKeyByHash: vi.fn().mockRejectedValue(new Error("D1 unavailable")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness({ store: store as unknown as Store });
    const body = (await (await h.call(search("ship it", "&key=pk_live_unchecked"))).json()) as SearchBody;
    expect(body).toMatchObject({ overLimit: true });
    expect(h.ai).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("search analytics", () => {
  it("logs the normalized text of every search that reaches the Worker, cache hits included", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_test" } });
    await h.call(search(" Rocket ", "&key=pk_test", { headers: { "cf-connecting-ip": "203.0.113.9" } }));
    await h.ctx.settle();
    await h.call(search("rocket", "&key=pk_test"));
    await h.call(keyedSearch("lava eruption", "&mode=semantic"));
    await h.call(search("volcano"));
    const points = h.events.mock.calls.map(([point]) => point);
    expect(points.map((p) => p.blobs)).toEqual([
      ["rocket", "en", "hybrid", "miss", "search"],
      ["rocket", "en", "hybrid", "hit", "search"],
      ["lava eruption", "en", "semantic", "miss", "search"],
      ["volcano", "en", "hybrid", "anonymous", "search"],
    ]);
    expect(points[0].indexes).toEqual(["test:bge-m3@8"]);
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
