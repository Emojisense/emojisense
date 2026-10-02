import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSemanticClient } from "../src/client.js";
import { createEngine } from "../src/engine.js";
import { createSearchSession, type SessionState } from "../src/session.js";
import { en } from "./fixture.js";

const semanticBody = {
  results: [{ emoji: "🌋", id: "1F30B", score: 0.7, source: "semantic" }],
  packVersion: "test",
  cached: false,
};

function fakeFetch() {
  return vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(semanticBody)));
}

describe("semantic client", () => {
  it("normalizes the query, sends the key as a parameter and caches", async () => {
    const fetch = fakeFetch();
    const client = createSemanticClient({ endpoint: "https://api.test/", key: "pk_1", fetch });
    await client.search("  Jurassic PARK!! ", { locale: "en", limit: 5 });
    await client.search("jurassic park", { locale: "en", limit: 5 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("q")).toBe("jurassic park");
    expect(url.searchParams.get("key")).toBe("pk_1");
  });

  it("keeps asking over the limit, because the edge cache still answers, but not twice", async () => {
    let overLimit = true;
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(overLimit ? { ...semanticBody, results: [], overLimit } : semanticBody)),
    );
    const client = createSemanticClient({ endpoint: "https://api.test", fetch });
    expect(await client.search("lava eruption")).toBeUndefined();
    expect(await client.search("lava eruption")).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    overLimit = false;
    expect(await client.search("congrats")).toMatchObject({ layer: "api" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("goes quiet after an over-limit answer when a cooldown is set", async () => {
    let now = 0;
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ...semanticBody, results: [], overLimit: true })),
    );
    const client = createSemanticClient({
      endpoint: "https://api.test",
      fetch,
      now: () => now,
      overLimitCooldownMs: 1000,
    });
    expect(await client.search("lava eruption")).toBeUndefined();
    expect(await client.search("volcano eruption")).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 2000;
    await client.search("volcano eruption");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on HTTP errors", async () => {
    const client = createSemanticClient({
      endpoint: "https://api.test",
      fetch: async () => new Response("nope", { status: 429 }),
    });
    await expect(client.search("x y z")).rejects.toThrow("HTTP 429");
  });
});

describe("search session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers alias results at once and fused results after the debounce", async () => {
    const fetch = fakeFetch();
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(en),
      semantic: createSemanticClient({ endpoint: "https://api.test", fetch }),
      debounceMs: 200,
      onChange: (s) => states.push(s),
    });

    session.update("volcano erupt");
    expect(states.at(-1)?.status).toBe("loading");
    session.update("volcano eruption");
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.status).toBe("fused");
    expect(states.at(-1)?.results.map((r) => r.emoji)).toContain("🌋");
  });

  it("keeps alias results when no layer answers", async () => {
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(en),
      semantic: { search: async () => undefined },
      debounceMs: 10,
      onChange: (s) => states.push(s),
    });
    session.update("volcano eruption");
    await vi.advanceTimersByTimeAsync(50);
    expect(states.at(-1)?.status).toBe("alias");
  });

  it("skips the network when the alias match is confident", async () => {
    const fetch = fakeFetch();
    const states: SessionState[] = [];
    const session = createSearchSession({
      engine: createEngine(en),
      semantic: createSemanticClient({ endpoint: "https://api.test", fetch }),
      onChange: (s) => states.push(s),
    });
    session.update("rocket");
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();
    expect(states.at(-1)?.status).toBe("alias");
  });
});
