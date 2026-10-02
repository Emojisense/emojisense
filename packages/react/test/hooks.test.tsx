import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEmojiSearch, useEmojisense, useRelevantNow } from "../src/hooks.js";
import { packAndCultureFetch, packFetch, packFetchWithExt } from "./fixture.js";

afterEach(() => vi.unstubAllGlobals());

describe("useEmojisense + useEmojiSearch", () => {
  it("loads packs, then searches as the query changes", async () => {
    vi.stubGlobal("fetch", packFetch());
    const { result: sense } = renderHook(() =>
      useEmojisense({ packBaseUrl: "https://x.test/v1/pack/test", locale: "tr", extended: false }),
    );
    expect(sense.current.status).toBe("loading");
    await waitFor(() => expect(sense.current.status).toBe("ready"));
    expect(sense.current.packs.map((p) => p.locale)).toEqual(["en", "tr"]);

    const { result, rerender } = renderHook(({ q }) => useEmojiSearch(q, sense.current), {
      initialProps: { q: "" },
    });
    expect(result.current.status).toBe("idle");
    rerender({ q: "jurassic park" });
    await waitFor(() => expect(result.current.results[0]?.emoji).toBe("🦖"));
    rerender({ q: "roket" });
    await waitFor(() => expect(result.current.results[0]?.emoji).toBe("🚀"));
    rerender({ q: "  " });
    expect(result.current.results).toEqual([]);
  });

  it("adds the extension packs when idle", async () => {
    vi.stubGlobal("fetch", packFetchWithExt());
    const { result: sense } = renderHook(() => useEmojisense({ packBaseUrl: "https://x.test" }));
    await waitFor(() => expect(sense.current.extended).toBe(true));
    const { result } = renderHook(() => useEmojiSearch("to infinity and beyond", sense.current));
    await waitFor(() => expect(result.current.results[0]?.emoji).toBe("🚀"));
  });

  it("reports load errors", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}"));
    const { result } = renderHook(() => useEmojisense({ packBaseUrl: "https://x.test" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("fuses semantic results after the debounce", async () => {
    const pack = packFetch();
    vi.stubGlobal("fetch", async (url: string | URL | Request) =>
      String(url).includes("/v1/search")
        ? new Response(
            JSON.stringify({
              results: [{ emoji: "🚀", id: "1F680", score: 0.6, source: "semantic" }],
              packVersion: "test",
              cached: false,
            }),
          )
        : pack(url),
    );
    const { result: sense } = renderHook(() =>
      useEmojisense({ packBaseUrl: "https://x.test", endpoint: "https://api.test", extended: false }),
    );
    await waitFor(() => expect(sense.current.status).toBe("ready"));
    const { result } = renderHook(() =>
      useEmojiSearch("to infinity and beyond", sense.current, { debounceMs: 10 }),
    );
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    await waitFor(() => expect(result.current.status).toBe("fused"));
    expect(result.current.results[0]?.emoji).toBe("🚀");
    expect(result.current.layer).toBe("api");
  });

  it("reports the device layer when no semantic layer is configured", async () => {
    vi.stubGlobal("fetch", packFetch());
    const { result: sense } = renderHook(() =>
      useEmojisense({ packBaseUrl: "https://x.test", extended: false }),
    );
    await waitFor(() => expect(sense.current.status).toBe("ready"));
    expect(sense.current.semantic).toBeUndefined();
    const { result } = renderHook(() => useEmojiSearch("jurassic park", sense.current));
    await waitFor(() => expect(result.current.status).toBe("alias"));
    expect(result.current.layer).toBe("device");
  });

  it("answers from shards before the API", async () => {
    const pack = packFetch();
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/p/test/index.json")) {
        return new Response(
          JSON.stringify({
            format: "emojisense-shards",
            formatVersion: 1,
            packVersion: "test",
            model: "m@256",
            keys: ["to"],
          }),
        );
      }
      if (url.endsWith("/p/test/to.json")) {
        return new Response(
          JSON.stringify({ key: "to", entries: { "to the stars": [["🚀", "1F680", 0.7]] } }),
        );
      }
      if (url.includes("/v1/search")) throw new Error("the API must not be called for a shard hit");
      return pack(input);
    });
    vi.stubGlobal("fetch", fetch);
    const { result: sense } = renderHook(() =>
      useEmojisense({
        packBaseUrl: "https://x.test",
        shardsUrl: "https://x.test/p/test",
        endpoint: "https://api.test",
        extended: false,
      }),
    );
    await waitFor(() => expect(sense.current.status).toBe("ready"));
    const { result } = renderHook(() => useEmojiSearch("to the stars", sense.current, { debounceMs: 10 }));
    await waitFor(() => expect(result.current.status).toBe("fused"));
    expect(result.current.layer).toBe("shard");
    expect(result.current.results[0]?.emoji).toBe("🚀");
  });
});

describe("culture layer", () => {
  const options = {
    packBaseUrl: "https://x.test/v1/pack/test",
    cultureUrl: "https://x.test/v1/culture",
    extended: false,
  };

  it("loads the culture file and adds its emoji after the top result", async () => {
    vi.stubGlobal("fetch", packAndCultureFetch());
    const { result: sense } = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(sense.current.culture?.locale).toBe("en"));
    expect(sense.current.engine?.culture).toBe(sense.current.culture);
    const { result } = renderHook(() => useEmojiSearch("jurassic park", sense.current));
    await waitFor(() => expect(result.current.results.map((r) => r.emoji)).toEqual(["🦖", "🚀"]));
    expect(result.current.results[1]).toMatchObject({
      source: "culture",
      context: "The dinosaur film series",
    });
    expect(result.current.alias?.results.map((r) => r.emoji)).toEqual(["🦖"]);
  });

  it("opts out with culture: false", async () => {
    vi.stubGlobal("fetch", packAndCultureFetch());
    const { result: sense } = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(sense.current.culture).toBeDefined());
    const { result } = renderHook(() => useEmojiSearch("jurassic park", sense.current, { culture: false }));
    await waitFor(() => expect(result.current.results.map((r) => r.emoji)).toEqual(["🦖"]));
  });

  it("works when the culture file cannot load", async () => {
    vi.stubGlobal("fetch", async (url: string | URL | Request) =>
      String(url).includes("/culture/") ? new Response("", { status: 404 }) : packFetch()(url),
    );
    const { result: sense } = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(sense.current.status).toBe("ready"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(sense.current.culture).toBeUndefined();
    const { result } = renderHook(() => useEmojiSearch("jurassic park", sense.current));
    await waitFor(() => expect(result.current.results.map((r) => r.emoji)).toEqual(["🦖"]));
  });

  it("lists relevant-now emoji from featured entries", async () => {
    vi.stubGlobal("fetch", packAndCultureFetch());
    const { result: sense } = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(sense.current.engine?.culture).toBeDefined());
    const { result } = renderHook(() => useRelevantNow(sense.current, { limit: 1 }));
    expect(result.current).toEqual([
      { emoji: "👍", hexcode: "1F44D", context: "A season", cultureId: "season" },
    ]);
  });
});
