import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createEngine, createShardProvider, type Shard, type ShardIndex, shardKeyFor } from "emojisense";
import { decodeVectors, encodeVectors, l2normalize } from "emojisense/vectors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShards } from "../src/shards/build.ts";
import { gzipBytes, loadShardEntries, readShardIndex, writeShardDir } from "../src/shards/files.ts";
import { shardJson, utf8Bytes } from "../src/shards/json.ts";
import { aggregateQueries, createWorkerGate, parseQueryLog } from "../src/shards/queries.ts";
import { createFakeResolver, createVectorResolver } from "../src/shards/resolvers.ts";
import { planShards } from "../src/shards/split.ts";
import { createResultStore } from "../src/shards/store.ts";
import type { QueryCount, ShardResolver } from "../src/shards/types.ts";
import { catalog, pack } from "./fixture.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "emojisense-shards-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const counted = (qs: string[]): QueryCount[] => qs.map((q) => ({ q, n: 5, locales: ["en"] }));

describe("query log", () => {
  it("parses JSONL rows and skips blank lines", () => {
    const rows = parseQueryLog('{"q":"ship it","n":12}\n\n{"q":"çok iyi","n":7,"locale":"tr"}\n');
    expect(rows).toEqual([
      { q: "ship it", n: 12 },
      { q: "çok iyi", n: 7, locale: "tr" },
    ]);
  });

  it("fails on a malformed line and names it", () => {
    expect(() => parseQueryLog('{"q":"a","n":5}\nnot json')).toThrow("line 2");
    expect(() => parseQueryLog('{"q":"a","n":0}')).toThrow("line 1");
  });

  it("normalizes, merges, applies the count threshold and keeps the most frequent", () => {
    const queries = aggregateQueries(
      [
        { q: "Ship it!", n: 3 },
        { q: "ship it", n: 4, locale: "tr" },
        { q: "rare one", n: 4 },
        { q: "lgtm", n: 9 },
        { q: "🚀", n: 50 },
        { q: "to the moon", n: 9 },
      ],
      { minCount: 5, maxQueries: 2 },
    );
    expect(queries).toEqual([
      { q: "lgtm", n: 9, locales: ["en"] },
      { q: "to the moon", n: 9, locales: ["en"] },
    ]);
    expect(
      aggregateQueries(
        [
          { q: "Ship it!", n: 3 },
          { q: "ship it", n: 4, locale: "tr" },
        ],
        {
          minCount: 5,
          maxQueries: 10,
        },
      ),
    ).toEqual([{ q: "ship it", n: 7, locales: ["en", "tr"] }]);
  });
});

describe("worker gate", () => {
  const gate = createWorkerGate([createEngine(pack)]);

  it("drops queries the device answers with confidence", () => {
    expect(gate({ q: "rocket", n: 5, locales: ["en"] })).toBe(false);
  });

  it("keeps conceptual and unknown queries", () => {
    expect(gate({ q: "congrats on the launch", n: 5, locales: ["en"] })).toBe(true);
    expect(gate({ q: "quarterly planning", n: 5, locales: ["en"] })).toBe(true);
  });
});

describe("result store", () => {
  it("packs results and writes the same JSON as JSON.stringify", () => {
    const store = createResultStore();
    store.set("ship it", [
      ["🚀", "1F680", 0.81234],
      ["🎉", "1F389", 0.7],
    ]);
    expect(store.get("ship it")).toEqual([
      ["🚀", "1F680", 0.812],
      ["🎉", "1F389", 0.7],
    ]);
    const shard: Shard = { key: "s", entries: { "ship it": store.get("ship it") ?? [] } };
    expect(JSON.stringify(shard)).toContain(store.entryJson("ship it"));
  });
});

describe("adaptive split", () => {
  // Size = number of entries, budget 4: easy to reason about.
  const byCount = {
    maxBytes: 4,
    entryBytes: () => 1,
    measure: (_: string, qs: readonly string[]) => qs.length,
  };
  const queries = [
    "the office",
    "the end",
    "the best",
    "the boys",
    "then what",
    "thanks",
    "thank you",
    "this is fine",
    "tada",
    "x files",
  ];

  it("gives hot prefixes longer keys and keeps every shard within budget", () => {
    const { plans, oversized } = planShards(queries, byCount);
    expect(oversized).toEqual([]);
    const keys = plans.map((p) => p.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain("x");
    expect(keys.some((k) => k.startsWith("the"))).toBe(true);
    for (const plan of plans) expect(plan.queries.length).toBeLessThanOrEqual(4);
  });

  it("puts each query in the shard of its longest matching key (the client rule)", () => {
    const { plans } = planShards(queries, byCount);
    const keys = plans.map((p) => p.key);
    for (const plan of plans) {
      for (const q of plan.queries) expect(shardKeyFor(keys, q)).toBe(plan.key);
    }
    expect(plans.flatMap((p) => p.queries).sort()).toEqual([...queries].sort());
  });

  it("keeps a query equal to its key in that key's shard", () => {
    const { plans } = planShards(["the", "the a", "the b", "the c", "the d", "the e"], byCount);
    const keys = plans.map((p) => p.key);
    expect(plans.find((p) => p.queries.includes("the"))?.key).toBe(shardKeyFor(keys, "the"));
  });

  it("never cuts a key inside a surrogate pair", () => {
    const astral = ["𠀀a", "𠀀b", "𠀀c", "𠀁a", "𠀁b", "𠀂", "𠀃", "𠀄"];
    const { plans } = planShards(astral, byCount);
    for (const plan of plans) expect(() => encodeURIComponent(plan.key)).not.toThrow();
  });

  it("stays within a real gzip budget", () => {
    const words = ["alpha", "beta", "gamma", "delta", "omega"];
    const many = Array.from({ length: 400 }, (_, i) => `the ${words[i % 5]} ${i}`);
    const text = (qs: readonly string[]) => JSON.stringify(qs.map((q) => [q, "🚀", "1F680", Math.random()]));
    const { plans } = planShards(many, {
      maxBytes: 1024,
      entryBytes: (q) => text([q]).length,
      measure: (_, qs) => gzipSync(text(qs)).length,
    });
    expect(plans.length).toBeGreaterThan(1);
    for (const plan of plans) expect(gzipSync(text(plan.queries)).length).toBeLessThanOrEqual(1024);
  });
});

describe("shard build", () => {
  const BUDGET = 700;
  const prefixes = ["the ", "the b", "co", "ca", "x", "дом ", "+1 "];
  const queries = counted(
    Array.from({ length: 240 }, (_, i) => `${prefixes[i % prefixes.length]}query ${i}`),
  );

  async function build(dir: string, resolver: ShardResolver = createFakeResolver(catalog)) {
    const built = await buildShards({
      queries,
      reachesWorker: () => true,
      resolver,
      packVersion: "test",
      resultsPerQuery: 4,
      maxShardBytes: BUDGET,
      shardBytes: gzipBytes,
    });
    const { gzip } = writeShardDir(dir, built.index, built.plans, built.store);
    return { built, gzip };
  }

  it("round-trips through the core shard provider", async () => {
    const dir = tempDir();
    const { built, gzip } = await build(dir);
    expect(built.stats).toMatchObject({ queries: 240, resolved: 240, unresolved: 0 });
    expect(built.index.keys.length).toBeGreaterThan(new Set(prefixes.map((p) => p[0])).size);
    expect(built.index.keys.some((k) => k.startsWith("the "))).toBe(true);
    for (const size of gzip) expect(size).toBeLessThanOrEqual(BUDGET);

    const base = "https://cdn.test/p/test";
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = join(dir, String(url).slice(base.length + 1));
      return existsSync(path) ? new Response(readFileSync(path)) : new Response("", { status: 404 });
    });
    const provider = createShardProvider({ baseUrl: base, fetch });
    for (const { q } of queries) {
      const response = await provider.search(q, { limit: 4 });
      expect(response?.layer).toBe("shard");
      expect(response?.model).toBe("fake@0");
      expect(response?.results.map((r) => [r.emoji, r.id, r.score])).toEqual(built.store.get(q));
    }
    expect(await provider.search("the query nobody asked")).toBeUndefined();
    // index.json once, then each shard at most once.
    expect(fetch).toHaveBeenCalledTimes(built.index.keys.length + 1);
  });

  it("writes index.json and one file per key, per PACK_FORMAT §6", async () => {
    const dir = tempDir();
    const { built } = await build(dir);
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as ShardIndex;
    expect(index).toMatchObject({ format: "emojisense-shards", formatVersion: 1, packVersion: "test" });
    expect(index.keys).toEqual([...index.keys].sort());
    const files = readdirSync(dir).filter((f) => f !== "index.json");
    expect(files.sort()).toEqual(index.keys.map((k) => `${encodeURIComponent(k)}.json`).sort());
    // "+" and " " are not file-name safe as is: the name is the encoded key.
    const plusKey = index.keys.find((k) => k.startsWith("+")) as string;
    expect(files).toContain(`%2B${encodeURIComponent(plusKey.slice(1))}.json`);
    const shard = JSON.parse(readFileSync(join(dir, `${encodeURIComponent(plusKey)}.json`), "utf8")) as Shard;
    expect(shard.key).toBe(plusKey);
    expect(Object.keys(shard.entries).every((q) => q.startsWith(plusKey))).toBe(true);
    expect(built.index).toEqual(index);
  });

  it("reuses entries of the previous build instead of resolving them again", async () => {
    const dir = tempDir();
    await build(dir);
    const resolver = createFakeResolver(catalog);
    const resolve = vi.spyOn(resolver, "resolve");
    const rebuilt = await buildShards({
      queries: [...queries, ...counted(["brand new query"])],
      reachesWorker: () => true,
      resolver,
      packVersion: "test",
      resultsPerQuery: 4,
      maxShardBytes: BUDGET,
      shardBytes: gzipBytes,
      previous: (wanted, store) => loadShardEntries(dir, wanted, 4, store),
    });
    expect(rebuilt.stats).toMatchObject({ reused: 240, resolved: 1 });
    expect(resolve).toHaveBeenCalledWith(["brand new query"], 4);
    expect(readShardIndex(dir)?.model).toBe("fake@0");
  });

  it("budgets raw UTF-8 bytes without a compressor (the Worker's mode)", async () => {
    const built = await buildShards({
      queries,
      reachesWorker: () => true,
      resolver: createFakeResolver(catalog),
      packVersion: "test",
      resultsPerQuery: 4,
      maxShardBytes: BUDGET * 3,
    });
    expect(built.stats.oversized).toEqual([]);
    for (const plan of built.plans) {
      const json = shardJson(plan.key, plan.queries, built.store);
      // The entries fit; the file adds only `{"key":…,"entries":{}}`.
      expect(utf8Bytes(json)).toBeLessThanOrEqual(BUDGET * 3 + 32 + utf8Bytes(plan.key));
      expect(utf8Bytes(json)).toBe(new TextEncoder().encode(json).length);
    }
  });

  it("never writes a shard named index, which would replace index.json", async () => {
    const qs = counted(["index", ...Array.from({ length: 30 }, (_, i) => `index finger ${i}`)]);
    const built = await buildShards({
      queries: qs,
      reachesWorker: () => true,
      resolver: createFakeResolver(catalog),
      packVersion: "test",
      resultsPerQuery: 4,
      maxShardBytes: 400,
    });
    // The split itself wants the key "index" here.
    const unfiltered = planShards([...built.store.queries()], {
      maxBytes: 400,
      maxRatio: 1,
      entryBytes: (q) => utf8Bytes(built.store.entryJson(q)) + 1,
      measure: () => Number.POSITIVE_INFINITY,
    });
    expect(unfiltered.plans.map((p) => p.key)).toContain("index");
    expect(built.index.keys).not.toContain("index");
    expect(built.plans.map((p) => p.key)).toEqual(built.index.keys);
    const placed = built.plans.flatMap((p) => p.queries);
    expect(placed).not.toContain("index");
    expect(placed).toContain("index finger 7");
  });

  it("drops what the device answers and reports unresolved queries", async () => {
    const offline: ShardResolver = { model: "m@8", resolve: async () => new Map() };
    const built = await buildShards({
      queries: counted(["rocket", "congrats on the launch"]),
      reachesWorker: createWorkerGate([createEngine(pack)]),
      resolver: offline,
      packVersion: "test",
      resultsPerQuery: 4,
      maxShardBytes: BUDGET,
      shardBytes: gzipBytes,
    });
    expect(built.stats).toMatchObject({ answeredOnDevice: 1, resolved: 0, unresolved: 1, shards: 0 });
    expect(built.index.keys).toEqual([]);
  });
});

describe("vector resolver", () => {
  const ids = ["1F680", "1F389", "1F525"];
  const rows = [
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0],
    [0.6, 0.8, 0, 0, 0, 0, 0, 0],
  ].map((r) => l2normalize(Float32Array.from(r)));
  const index = decodeVectors(encodeVectors("@cf/test/model", ids, rows));

  it("ranks like the Worker: truncate, re-normalize, dot product, three decimals", async () => {
    const resolver = createVectorResolver({
      tag: "test@8",
      index,
      emojiOf: (id) => catalog.find((c) => c.id === id)?.emoji,
      embedder: {
        // 10 dims from the "model"; the index uses the first 8.
        embed: async (qs) =>
          qs.map((q) => (q === "unknown" ? undefined : Float32Array.from([2, 0.1, 0, 0, 0, 0, 0, 0, 9, 9]))),
      },
    });
    const results = await resolver.resolve(["ship it", "unknown"], 2);
    expect(resolver.model).toBe("test@8");
    expect(results.has("unknown")).toBe(false);
    const top = results.get("ship it") ?? [];
    expect(top.map(([emoji, id]) => [emoji, id])).toEqual([
      ["🚀", "1F680"],
      ["🔥", "1F525"],
    ]);
    for (const [, , score] of top) expect(Math.round(score * 1000) / 1000).toBe(score);
  });
});
