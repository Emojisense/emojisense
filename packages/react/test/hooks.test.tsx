import { act, renderHook, waitFor } from "@testing-library/react";
import type { Culture } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEmojiSearch, useEmojisense, useRelevantNow } from "../src/hooks.js";
import { culture, packAndCultureFetch, packFetch, packFetchWithExt } from "./fixture.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    // The extension index waits for a pause in typing; the test before this one typed.
    await waitFor(() => expect(sense.current.extended).toBe(true), { timeout: 5000 });
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

  it("shows the new day's relevant-now emoji on a render after midnight", () => {
    const [season] = culture.entries;
    if (!season) throw new Error("fixture has no season");
    const oneDay: Culture = {
      ...culture,
      entries: [{ ...season, when: { from: "10-31", to: "10-31", recurs: "yearly" } }],
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 31, 23, 50));
      const sense = { culture: oneDay, engine: undefined };
      const { result, rerender } = renderHook(() => useRelevantNow(sense));
      expect(result.current.map((r) => r.emoji)).toEqual(["👍", "🚀"]);
      vi.setSystemTime(new Date(2026, 10, 1, 0, 10));
      rerender();
      expect(result.current).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("culture region", () => {
  /** "jurassic park" also adds 👍, but only in Brazil. */
  const regional: Culture = {
    ...culture,
    entries: [
      ...culture.entries,
      {
        id: "dino-br",
        kind: "lasting",
        context: "A regional association",
        when: null,
        regions: ["BR"],
        triggers: ["jurassic park"],
        emoji: [["👍", "1F44D", 0.7]],
      },
    ],
  };
  const options = {
    packBaseUrl: "https://x.test/v1/pack/test",
    cultureUrl: "https://x.test/v1/culture",
    extended: false,
  };

  /** Packs, the regional culture file and the search API; returns every request URL. */
  function serve(answerRegion?: string) {
    const packs = packFetch();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/culture/culture.en.json")) return new Response(JSON.stringify(regional));
      if (u.includes("/v1/search")) {
        const results = [{ emoji: "🚀", id: "1F680", score: 0.6, source: "semantic" }];
        const region = answerRegion ? { region: answerRegion } : {};
        return new Response(JSON.stringify({ results, packVersion: "test", cached: false, ...region }));
      }
      return packs(url);
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const speak = (language: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(language);

  async function search(sense: { current: ReturnType<typeof useEmojisense> }, query = "jurassic park") {
    await waitFor(() => expect(sense.current.engine?.culture).toBeDefined());
    const { result } = renderHook(() => useEmojiSearch(query, sense.current, { debounceMs: 10 }));
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0));
    return result.current.results.map((r) => r.emoji);
  }

  it("defaults to the region of the browser's language", async () => {
    serve();
    speak("pt-BR");
    const { result: sense } = renderHook(() => useEmojisense(options));
    expect(sense.current.region).toBe("BR");
    expect(await search(sense)).toEqual(["🦖", "👍", "🚀"]);
  });

  it("has no region when the browser's language has no region subtag", async () => {
    serve();
    speak("pt");
    const { result: sense } = renderHook(() => useEmojisense(options));
    expect(sense.current.region).toBeUndefined();
    expect(await search(sense)).toEqual(["🦖", "🚀"]);
  });

  it("prefers the app's region, and an empty region turns regional entries off", async () => {
    serve();
    speak("en-US");
    const { result: brazil } = renderHook(() => useEmojisense({ ...options, region: "BR" }));
    expect(await search(brazil)).toEqual(["🦖", "👍", "🚀"]);
    speak("pt-BR");
    const { result: none } = renderHook(() => useEmojisense({ ...options, region: "" }));
    expect(none.current.region).toBeUndefined();
    expect(await search(none)).toEqual(["🦖", "🚀"]);
  });

  it("with region auto, asks the API for the region and applies it to later searches", async () => {
    const fetch = serve("BR");
    speak("en-US");
    const { result: sense } = renderHook(() =>
      useEmojisense({ ...options, endpoint: "https://api.test", publishableKey: "pk_test", region: "auto" }),
    );
    await waitFor(() => expect(sense.current.engine?.culture).toBeDefined());
    const { result, rerender } = renderHook(
      ({ query }) => useEmojiSearch(query, sense.current, { debounceMs: 10 }),
      { initialProps: { query: "jurassic park" } },
    );
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0));
    expect(result.current.results.map((r) => r.emoji)).not.toContain("👍");
    rerender({ query: "to infinity and beyond" });
    await waitFor(() => expect(result.current.status).toBe("fused"));
    rerender({ query: "jurassic park" });
    await waitFor(() => expect(result.current.results.map((r) => r.emoji)).toContain("👍"));
    const searches = fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/v1/search"));
    expect(searches.every((url) => new URL(url).searchParams.get("region") === "auto")).toBe(true);
    // The shelf has no search to learn from: entries for every region only.
    const { result: shelf } = renderHook(() => useRelevantNow(sense.current));
    expect(shelf.current.every((item) => item.cultureId !== "dino-br")).toBe(true);
  });

  it("never sends the region", async () => {
    const fetch = serve();
    speak("pt-BR");
    const { result: sense } = renderHook(() =>
      useEmojisense({ ...options, endpoint: "https://api.test", publishableKey: "pk_test" }),
    );
    await search(sense, "to infinity and beyond");
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/v1/search"))).toBe(true);
    for (const url of urls) expect(url).not.toMatch(/BR|region/i);
  });
});
