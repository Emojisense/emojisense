import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEmojiSearch, useEmojisense } from "../src/hooks.js";
import { packFetch, packFetchWithExt } from "./fixture.js";

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
  });
});
