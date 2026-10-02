import { getModel } from "@emojisense/data/models";
import { createEngine, decodeVectors, encodeVectors, l2normalize, type Pack } from "emojisense";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { type CacheLike, type Catalog, handleSearch, type SearchBody } from "../src/search.ts";

const row = (emoji: string, hexcode: string, label: string, alias = ""): Pack["emoji"][number] => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  "",
  alias,
  "",
  "",
];
const pack: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["g"],
  emoji: [
    row("🦖", "1F996", "T-Rex", "jurassic park"),
    row("🌋", "1F30B", "volcano"),
    row("🚀", "1F680", "rocket", "ship it"),
  ],
};

const DIMS = 8;
const unit = (i: number) => l2normalize(Float32Array.from({ length: DIMS }, (_, d) => (d === i ? 1 : 0.01)));
const catalog: Catalog = {
  config: {
    packVersion: "test",
    modelKey: "embeddinggemma",
    modelId: "@cf/google/embeddinggemma-300m",
    dims: DIMS,
    queryTemplate: "task: search result | query: {q}",
  },
  model: getModel("embeddinggemma"),
  engine: () => createEngine(pack),
  index: () =>
    decodeVectors(
      encodeVectors(
        "@cf/google/embeddinggemma-300m",
        ["1F996", "1F30B", "1F680"],
        [unit(0), unit(1), unit(2)],
      ),
    ),
};

function memoryCache(): CacheLike & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (r) => store.get(r.url)?.clone(),
    put: async (r, res) => void store.set(r.url, res.clone()),
  };
}

const ctx = { waitUntil: (p: Promise<unknown>) => void p };
const get = (q: string, extra = "") =>
  new Request(`https://api.test/v1/search?q=${encodeURIComponent(q)}${extra}`);

describe("GET /v1/search", () => {
  let env: Env;
  let ai: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    // Every query embeds near the "volcano" row.
    ai = vi.fn(async () => ({ data: [Array.from(unit(1))] }));
    env = { AI: { run: ai }, PUBLISHABLE_KEYS: "pk_test", EVENTS: { writeDataPoint: vi.fn() } };
  });

  it("fuses alias and semantic results and formats the query for the model", async () => {
    const res = await handleSearch(get("Lava eruption!!"), env, ctx, catalog, memoryCache());
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body.query).toBe("lava eruption");
    expect(body.results[0]).toMatchObject({ emoji: "🌋", source: "semantic" });
    expect(ai).toHaveBeenCalledWith("@cf/google/embeddinggemma-300m", {
      text: ["task: search result | query: lava eruption"],
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("keeps confident alias hits on top in hybrid mode", async () => {
    const body = (await (
      await handleSearch(get("jurassic park"), env, ctx, catalog, memoryCache())
    ).json()) as SearchBody;
    expect(body.results[0]).toMatchObject({ emoji: "🦖", source: "alias" });
  });

  it("returns semantic results only in semantic mode", async () => {
    const body = (await (
      await handleSearch(get("jurassic park", "&mode=semantic"), env, ctx, catalog, memoryCache())
    ).json()) as SearchBody;
    expect(body.results.every((r) => r.source === "semantic")).toBe(true);
  });

  it("serves the second identical query from cache, ignoring the key and raw spelling", async () => {
    const cache = memoryCache();
    await handleSearch(get("Lava  eruption", "&key=pk_test"), env, ctx, catalog, cache);
    const second = await handleSearch(get("lava eruption"), env, ctx, catalog, cache);
    expect(((await second.json()) as SearchBody).cached).toBe(true);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it("degrades to alias-only results when Workers AI fails, and does not cache them", async () => {
    const cache = memoryCache();
    env.AI = { run: async () => Promise.reject(new Error("not logged in")) };
    const res = await handleSearch(get("rocket"), env, ctx, catalog, cache);
    const body = (await res.json()) as SearchBody;
    expect(body.degraded).toBe(true);
    expect(body.results[0]?.emoji).toBe("🚀");
    expect(cache.store.size).toBe(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unknown keys, empty queries and rate-limited callers", async () => {
    expect((await handleSearch(get("x", "&key=pk_nope"), env, ctx, catalog, memoryCache())).status).toBe(401);
    expect((await handleSearch(get("🚀"), env, ctx, catalog, memoryCache())).status).toBe(400);
    env.ANON_LIMITER = { limit: async () => ({ success: false }) };
    expect((await handleSearch(get("rocket"), env, ctx, catalog, memoryCache())).status).toBe(429);
  });

  it("logs query text only for Tier 0 misses", async () => {
    const write = vi.fn();
    env.EVENTS = { writeDataPoint: write };
    await handleSearch(get("rocket"), env, ctx, catalog, memoryCache());
    await handleSearch(get("lava eruption"), env, ctx, catalog, memoryCache());
    expect(write.mock.calls[0]?.[0].blobs[0]).toBe("");
    expect(write.mock.calls[1]?.[0].blobs[0]).toBe("lava eruption");
    expect(JSON.stringify(write.mock.calls)).not.toContain("pk_");
  });
});
