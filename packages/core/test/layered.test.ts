import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/engine.js";
import { groupLabel } from "../src/groups.js";
import { createLayeredSemantic } from "../src/layered.js";
import { createSearchSession, type SessionState } from "../src/session.js";
import { en } from "./fixture.js";

const shardIndex = {
  format: "emojisense-shards",
  formatVersion: 1,
  packVersion: "test",
  model: "m@256",
  keys: ["v"],
};
const shard = { key: "v", entries: { "volcano eruption": [["🌋", "1F30B", 0.8]] } };
const apiBody = {
  results: [{ emoji: "☕", id: "2615", score: 0.7, source: "semantic" }],
  packVersion: "test",
  cached: false,
};

/** Serves shards under /p/test/ and the API under /v1/search; `shards: false` = no shards deployed. */
function fakeFetch({ shards = true, overLimit = false } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/search") {
      return new Response(JSON.stringify({ ...apiBody, ...(overLimit ? { results: [], overLimit } : {}) }));
    }
    if (shards && url.pathname === "/p/test/index.json") return new Response(JSON.stringify(shardIndex));
    if (shards && url.pathname === "/p/test/v.json") return new Response(JSON.stringify(shard));
    return new Response("", { status: 404 });
  });
}

const apiCalls = (fetch: ReturnType<typeof fakeFetch>) =>
  fetch.mock.calls.filter(([input]) => String(input).includes("/v1/search"));

describe("createLayeredSemantic", () => {
  it("returns undefined without shards or an endpoint, so search stays on device", () => {
    expect(createLayeredSemantic({})).toBeUndefined();
    expect(createLayeredSemantic({ key: "pk_1", packVersion: "test" })).toBeUndefined();
  });

  it("answers from a shard without calling the metered API", async () => {
    const fetch = fakeFetch();
    const semantic = createLayeredSemantic({
      shardsUrl: "https://cdn.test/p/test",
      endpoint: "https://api.test",
      fetch,
    });
    const response = await semantic?.search("Volcano  eruption");
    expect(response?.layer).toBe("shard");
    expect(response?.results[0]?.emoji).toBe("🌋");
    expect(apiCalls(fetch)).toHaveLength(0);
  });

  it("falls through to the API on a shard miss, with key and pack version", async () => {
    const fetch = fakeFetch();
    const semantic = createLayeredSemantic({
      shardsUrl: "https://cdn.test/p/test",
      endpoint: "https://api.test",
      key: "pk_1",
      packVersion: "test",
      fetch,
    });
    const response = await semantic?.search("coffee time");
    expect(response?.layer).toBe("api");
    const [call] = apiCalls(fetch);
    const params = new URL(String(call?.[0])).searchParams;
    expect(params.get("key")).toBe("pk_1");
    expect(params.get("pack")).toBe("test");
  });

  it("uses the API alone when no shards are deployed", async () => {
    const fetch = fakeFetch({ shards: false });
    const viaShards = createLayeredSemantic({
      shardsUrl: "https://cdn.test/p/test",
      endpoint: "https://api.test",
      fetch,
    });
    expect((await viaShards?.search("volcano eruption"))?.layer).toBe("api");
    const apiOnly = createLayeredSemantic({ endpoint: "https://api.test", fetch });
    expect((await apiOnly?.search("volcano eruption"))?.layer).toBe("api");
  });

  it("returns undefined with shards only and a shard miss", async () => {
    const semantic = createLayeredSemantic({ shardsUrl: "https://cdn.test/p/test", fetch: fakeFetch() });
    expect(await semantic?.search("coffee time")).toBeUndefined();
  });
});

describe("layered search session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = async (query: string, fetch: ReturnType<typeof fakeFetch>) => {
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(en),
      semantic: createLayeredSemantic({
        shardsUrl: "https://cdn.test/p/test",
        endpoint: "https://api.test",
        fetch,
      }),
      debounceMs: 10,
      onChange: (s) => states.push(s),
    });
    session.update(query);
    await vi.advanceTimersByTimeAsync(50);
    return states.at(-1);
  };

  it("reports the layer that answered", async () => {
    expect((await run("volcano eruption", fakeFetch()))?.layer).toBe("shard");
    expect((await run("coffee time", fakeFetch()))?.layer).toBe("api");
  });

  it("loads the index at once and answers from a loaded shard on the next keystroke, with no debounce", async () => {
    const fetch = fakeFetch();
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(en),
      semantic: createLayeredSemantic({
        shardsUrl: "https://cdn.test/p/test",
        endpoint: "https://api.test",
        fetch,
      }),
      debounceMs: 1000,
      onChange: (s) => states.push(s),
    });
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/p/test/index.json",
    ]);
    session.update("volcano erupti");
    await vi.advanceTimersByTimeAsync(5);
    session.update("volcano eruption");
    expect(states.at(-1)).toMatchObject({ status: "fused", layer: "shard", semanticMs: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(apiCalls(fetch)).toHaveLength(0);
  });

  it("keeps the alias results when the key is over its limit", async () => {
    const state = await run("coffee time", fakeFetch({ overLimit: true }));
    expect(state?.status).toBe("alias");
    expect(state?.layer).toBeUndefined();
  });
});

describe("groupLabel", () => {
  it("localizes pack groups and falls back to English, then to the key", () => {
    expect(groupLabel("food-drink", "tr")).toBe("Yiyecek ve içecek");
    expect(groupLabel("food-drink", "de")).toBe("Food & drink");
    expect(groupLabel("component")).toBe("component");
  });
});
