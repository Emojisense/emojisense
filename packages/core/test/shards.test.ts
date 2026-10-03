import { describe, expect, it, vi } from "vitest";
import { chainProviders } from "../src/provider.js";
import { createShardProvider, shardBaseFor, shardKeyFor } from "../src/shards.js";

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

describe("shards per locale", () => {
  /** en shards at the root, tr shards in tr/, no de shards. */
  function localeFetch() {
    const files: Record<string, unknown> = {
      "index.json": index,
      "co.json": shards["co.json"],
      "tr/index.json": { ...index, keys: ["do"] },
      "tr/do.json": { key: "do", entries: { "dogum gunu": [["🎂", "1F382", 0.9]] } },
    };
    return vi.fn(async (url: string | URL | Request) => {
      const body = files[String(url).split("/p/1/")[1] ?? ""];
      return body ? new Response(JSON.stringify(body)) : new Response("", { status: 404 });
    });
  }

  it("keeps English at the base URL and puts other locales in their directory", () => {
    expect(shardBaseFor("https://x.test/p/1/", undefined)).toBe("https://x.test/p/1");
    expect(shardBaseFor("https://x.test/p/1", "EN")).toBe("https://x.test/p/1");
    expect(shardBaseFor("https://x.test/p/1", "TR")).toBe("https://x.test/p/1/tr");
    expect(shardBaseFor("https://x.test/p/1", "pt-BR")).toBe("https://x.test/p/1/pt");
    expect(shardBaseFor("https://x.test/p/1", "en_GB")).toBe("https://x.test/p/1");
  });

  it("reads the shards of the search's locale, each directory once", async () => {
    const fetch = localeFetch();
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch });
    expect((await provider.search("dogum gunu", { locale: "tr" }))?.results[0]?.emoji).toBe("🎂");
    expect(await provider.search("dogum gunu", { locale: "en" })).toBeUndefined();
    expect((await provider.search("congrats on the launch"))?.layer).toBe("shard");
    expect(await provider.search("congrats on the launch", { locale: "tr" })).toBeUndefined();
    expect(fetch.mock.calls.map(([url]) => String(url).split("/p/1/")[1])).toEqual([
      "tr/index.json",
      "tr/do.json",
      "index.json",
      "co.json",
    ]);
  });

  it("leaves a locale without shards to the API and does not ask for its index again", async () => {
    const fetch = localeFetch();
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch });
    expect(await provider.search("congrats on the launch", { locale: "de" })).toBeUndefined();
    expect(await provider.search("congrats on the launch", { locale: "de" })).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("hashed files and the base layer", () => {
  /** Live English index with hashed files and a base index; base files are in f/ as well. */
  function layeredFetch({ failOnce = new Set<string>() } = {}) {
    const files: Record<string, unknown> = {
      "index.json": {
        ...index,
        keys: ["co"],
        files: { co: "f/live-co.json" },
        base: "f/base-en.json",
      },
      "f/live-co.json": shards["co.json"],
      "f/base-en.json": { ...index, keys: ["th"], files: { th: "base-th.json" } },
      "f/base-th.json": { key: "th", entries: { "thank you so much": [["🙏", "1F64F", 0.9]] } },
      "tr/index.json": { ...index, keys: [], files: {}, base: "../f/base-en.json" },
    };
    return vi.fn(async (url: string | URL | Request) => {
      const path = String(url).split("/p/1/")[1] ?? "";
      if (failOnce.delete(path)) throw new TypeError("network down");
      const body = files[path];
      return body ? new Response(JSON.stringify(body)) : new Response("", { status: 404 });
    });
  }
  const paths = (fetch: ReturnType<typeof layeredFetch>) =>
    fetch.mock.calls.map(([url]) => String(url).split("/p/1/")[1]);

  it("reads the files the index names, then the base layer", async () => {
    const fetch = layeredFetch();
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch });
    expect((await provider.search("congrats on the launch"))?.results[0]?.emoji).toBe("🚀");
    expect((await provider.search("thank you so much"))?.results[0]?.emoji).toBe("🙏");
    expect(await provider.search("thanks a lot")).toBeUndefined();
    expect(paths(fetch)).toEqual(["index.json", "f/base-en.json", "f/live-co.json", "f/base-th.json"]);
  });

  it("resolves a base index named relative to a locale directory", async () => {
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch: layeredFetch() });
    expect((await provider.search("thank you so much", { locale: "tr" }))?.layer).toBe("shard");
  });

  it("peeks only at what is loaded, and prefetch loads it", async () => {
    const fetch = layeredFetch();
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch });
    expect(provider.peek?.("thank you so much")).toBeUndefined();
    provider.prefetch?.("thank you");
    await vi.waitFor(() => expect(paths(fetch)).toContain("f/base-th.json"));
    await Promise.all(fetch.mock.results.map((r) => r.value));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.peek?.("thank you so much")?.results[0]?.emoji).toBe("🙏");
    expect(provider.peek?.("thank you so much", { limit: 0 })?.results).toEqual([]);
    expect(provider.peek?.("thank you!")).toBeUndefined();
  });

  it("asks again after a network error, but not after a 404", async () => {
    const fetch = layeredFetch({ failOnce: new Set(["index.json"]) });
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch });
    expect(await provider.search("congrats on the launch")).toBeUndefined();
    expect((await provider.search("congrats on the launch"))?.layer).toBe("shard");
    expect(await provider.search("thanks", { locale: "de" })).toBeUndefined();
    expect(await provider.search("thanks", { locale: "de" })).toBeUndefined();
    expect(paths(fetch).filter((p) => p === "index.json")).toHaveLength(2);
    expect(paths(fetch).filter((p) => p === "de/index.json")).toHaveLength(1);
  });

  it("gives up on a file that does not arrive in time", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const provider = createShardProvider({ baseUrl: "https://x.test/p/1", fetch, timeoutMs: 5 });
    expect(await provider.search("congrats on the launch")).toBeUndefined();
  });
});
