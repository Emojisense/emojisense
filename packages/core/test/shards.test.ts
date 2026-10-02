import { describe, expect, it, vi } from "vitest";
import { chainProviders } from "../src/provider.js";
import { createShardProvider, shardKeyFor } from "../src/shards.js";

const index = {
  format: "emojisense-shards",
  formatVersion: 1,
  packVersion: "t",
  model: "m@256",
  keys: ["c", "co", "th", "the "],
};
const shards: Record<string, unknown> = {
  "co.json": {
    key: "co",
    entries: {
      "congrats on the launch": [
        ["🚀", "1F680", 0.8],
        ["🎉", "1F389", 0.7],
      ],
    },
  },
  "the%20.json": { key: "the ", entries: { "the office": [["🏢", "1F3E2", 0.6]] } },
};

function fakeFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url).split("/p/1/")[1] ?? "";
    const body = path === "index.json" ? index : shards[path];
    return body ? new Response(JSON.stringify(body)) : new Response("", { status: 404 });
  });
}

describe("shard provider", () => {
  it("picks the longest matching prefix key", () => {
    expect(shardKeyFor(index.keys, "the office")).toBe("the ");
    expect(shardKeyFor(index.keys, "cat")).toBe("c");
    expect(shardKeyFor(index.keys, "zebra")).toBeUndefined();
  });

  it("answers from a shard and downloads each shard once", async () => {
    const fetch = fakeFetch();
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1/", fetch });
    const first = await provider.search("Congrats  on the launch");
    expect(first?.layer).toBe("shard");
    expect(first?.results.map((r) => r.emoji)).toEqual(["🚀", "🎉"]);
    await provider.search("congrats on the launch");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await provider.search("the office"))?.results[0]?.emoji).toBe("🏢");
  });

  it("leaves text typed with accents, punctuation or emoji to the API, which embeds it as typed", async () => {
    const fetch = fakeFetch();
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch });
    for (const typed of ["congrats on the launch!", "cöngrats on the launch", "congrats on the launch 🚀"]) {
      expect(await provider.search(typed)).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect((await provider.search("CONGRATS on the launch"))?.layer).toBe("shard");
  });

  it("returns undefined for unknown queries so the next layer is asked", async () => {
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch: fakeFetch() });
    const api = {
      search: vi.fn(async () => ({ results: [], packVersion: "t", cached: false, layer: "api" as const })),
    };
    const chained = chainProviders(provider, api);
    expect((await chained.search("coffee time"))?.layer).toBe("api");
    expect((await chained.search("congrats on the launch"))?.layer).toBe("shard");
    expect(api.search).toHaveBeenCalledTimes(1);
  });
});
