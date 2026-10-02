import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSemanticClient } from "../src/client.js";
import type { Culture } from "../src/culture.js";
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
  it("sends the embedding text (accents kept), sends the key as a parameter and caches", async () => {
    const fetch = fakeFetch();
    const client = createSemanticClient({ endpoint: "https://api.test/", key: "pk_1", fetch });
    await client.search("  Doğum   GÜNÜ!! ", { locale: "tr", limit: 5 });
    await client.search("doğum günü!!", { locale: "tr", limit: 5 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("q")).toBe("doğum günü!!");
    expect(url.searchParams.get("key")).toBe("pk_1");
  });

  it("asks the API for the caller's region only with region auto, and never sends a region code", async () => {
    const fetch = fakeFetch();
    const client = createSemanticClient({ endpoint: "https://api.test", key: "pk_1", fetch });
    await client.search("volcano", { region: "AUTO" });
    await client.search("lava", { region: "BR" });
    await client.search("magma");
    const sent = fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    // The parameter order of the Kotlin client, so both share browser and proxy cache entries.
    const names = String(sent[0])
      .split("&")
      .map((pair) => pair.split("=")[0]);
    expect(names).toEqual(["q", "locale", "limit", "mode", "region", "key"]);
    expect(sent.map((params) => params.get("region"))).toEqual(["auto", null, null]);
  });

  it("does not ask for a query without searchable text", async () => {
    const fetch = fakeFetch();
    const client = createSemanticClient({ endpoint: "https://api.test/", fetch });
    expect(await client.search(" 🎉 !! ")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps asking over the limit, because the edge cache still answers, but not twice", async () => {
    let overLimit = true;
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(overLimit ? { ...semanticBody, results: [], overLimit } : semanticBody)),
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
    expect(states.at(-1)).toMatchObject({ unsure: false });
  });
});

describe("unsure queries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The API's answer for an unsure query: a flat, low semantic list. */
  const unsureBody = {
    packVersion: "test",
    cached: false,
    unsure: true,
    confidence: 0,
    results: [
      { emoji: "🌋", id: "1F30B", score: 0.4, source: "semantic" },
      { emoji: "🐐", id: "1F410", score: 0.39, source: "semantic" },
    ],
  };

  it("calls a query unsure while it waits and after a flat semantic list, and asks once", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(unsureBody)));
    const states: SessionState[] = [];
    createSearchSession({
      engine: createEngine(en),
      semantic: createSemanticClient({ endpoint: "https://api.test", fetch }),
      debounceMs: 10,
      onChange: (s) => states.push(s),
    }).update("kendrick lamar");
    expect(states.at(-1)).toMatchObject({ status: "loading", unsure: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ status: "fused", unsure: true });
    expect(states.at(-1)?.results[0]).toMatchObject({ source: "semantic" });
  });
});

describe("search session with region auto", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A culture entry for Great Britain only. */
  const culture: Culture = {
    format: "emojisense-culture",
    formatVersion: 1,
    packVersion: "test",
    locale: "en",
    from: "2026-01-01",
    until: "2027-12-31",
    entries: [
      {
        id: "eruption-dino",
        kind: "lasting",
        context: "In this test region, eruptions come with dinosaurs",
        when: null,
        regions: ["GB"],
        triggers: ["volcano eruption"],
        emoji: [["🦖", "1F996", 0.9]],
      },
    ],
    relevantNow: [],
  };

  function session(region: string, answerRegion: string | null) {
    const fetch = vi.fn(
      async (_url: string | URL | Request) =>
        new Response(JSON.stringify({ ...semanticBody, region: answerRegion })),
    );
    const states: SessionState[] = [];
    const s = createSearchSession({
      engine: createEngine(en),
      semantic: createSemanticClient({ endpoint: "https://api.test", fetch }),
      culture,
      region,
      debounceMs: 10,
      onChange: (state) => states.push(state),
    });
    const glyphs = () => states.at(-1)?.results.map((r) => r.emoji) ?? [];
    return { fetch, s, glyphs };
  }

  it("applies regional entries once an API answer reports the caller's region", async () => {
    const { fetch, s, glyphs } = session("auto", "GB");
    s.update("volcano eruption");
    expect(glyphs()).not.toContain("🦖");
    await vi.advanceTimersByTimeAsync(50);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("region")).toBe("auto");
    expect(glyphs()).toEqual(["🌋", "🦖"]);
    // Later keystrokes keep the learned region, before any new answer.
    s.update("volcano eruption ");
    expect(glyphs()).toContain("🦖");
  });

  it("keeps regional entries off while the API does not know the region", async () => {
    const { s, glyphs } = session("auto", null);
    s.update("volcano eruption");
    await vi.advanceTimersByTimeAsync(50);
    expect(glyphs()).toEqual(["🌋"]);
  });

  it("keeps an explicit region on the device, whatever the API reports", async () => {
    const { fetch, s, glyphs } = session("US", "GB");
    s.update("volcano eruption");
    await vi.advanceTimersByTimeAsync(50);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.has("region")).toBe(false);
    expect(glyphs()).toEqual(["🌋"]);
  });
});
