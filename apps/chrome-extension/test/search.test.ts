import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchService, type SearchPort, type SearchServiceDeps } from "../src/background/search";
import type { ServerMessage } from "../src/shared/messages";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";
import { en, flush, tr } from "./fixture";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function fakePort() {
  const received: ServerMessage[] = [];
  let onMessage: (message: unknown) => void = () => undefined;
  let onDisconnect: () => void = () => undefined;
  const port: SearchPort = {
    postMessage: (message) => received.push(message),
    onMessage: { addListener: (listener) => (onMessage = listener) },
    onDisconnect: { addListener: (listener) => (onDisconnect = listener) },
  };
  return {
    port,
    received,
    send: (message: unknown) => onMessage(message),
    disconnect: () => onDisconnect(),
    last: () => received.at(-1),
  };
}

function service(settings: Partial<Settings> = {}, overrides: Partial<SearchServiceDeps> = {}) {
  const deps: SearchServiceDeps = {
    loadPacks: vi.fn(async () => [en, tr]),
    readSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
    readRecents: async () => ["1F996"],
    recordPick: vi.fn(async () => undefined),
    uiLanguage: () => "en-US",
    fetch: vi.fn(async () => new Response("{}", { status: 500 })),
    debounceMs: 10,
    ...overrides,
  };
  return { deps, search: createSearchService(deps) };
}

const emojis = (message: ServerMessage | undefined) =>
  message?.type === "results" ? message.items.map((item) => item.emoji).join("") : "";

describe("search service (service worker)", () => {
  it("answers an empty query with recent emoji, the user's own first", async () => {
    const { search } = service();
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "" });
    await flush();

    const message = client.last();
    expect(message).toMatchObject({ type: "results", query: "", status: "recent" });
    // 🦖 was picked before; the defaults this fixture pack knows follow (unknown ids are dropped).
    expect(emojis(message)).toBe("🦖👍️❤️🚀");
  });

  it("serves on-device results with labels in the chosen language", async () => {
    const { search } = service({ locale: "tr" });
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "roket" });
    await flush();

    expect(client.last()).toMatchObject({
      type: "results",
      query: "roket",
      status: "alias",
      items: [{ emoji: "🚀", id: "1F680", label: "roket", source: "alias" }],
    });
  });

  it("applies the skin tone setting", async () => {
    const { search } = service({ skinTone: "medium" });
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "lgtm" });
    await flush();

    expect(emojis(client.last())).toBe("👍🏽");
  });

  it("keeps only the newest query sent before the index was ready", async () => {
    let release: (packs: (typeof en)[]) => void = () => undefined;
    const { search } = service({}, { loadPacks: () => new Promise((resolve) => (release = resolve)) });
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "dino" });
    client.send({ type: "query", query: "rocket" });
    release([en, tr]);
    await flush();

    expect(client.received).toHaveLength(1);
    expect(client.last()).toMatchObject({ query: "rocket" });
  });

  it("builds the index once for all pickers", async () => {
    const { search, deps } = service();
    search.attach(fakePort().port);
    search.attach(fakePort().port);
    await search.warm();
    expect(deps.loadPacks).toHaveBeenCalledTimes(1);
  });

  it("stays on device when search by meaning is off (the default)", async () => {
    const { search, deps } = service();
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "we finally launched it" });
    await flush();
    await vi.advanceTimersByTimeAsync(50);

    expect(deps.fetch).not.toHaveBeenCalled();
    expect(client.last()).toMatchObject({ status: "alias" });
  });

  it("asks the API for semantic results when configured, and fuses them in", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request) =>
        new Response(
          JSON.stringify({
            query: "we finally launched it",
            results: [{ emoji: "🚀", id: "1F680", score: 0.8, source: "semantic" }],
            packVersion: "test",
            cached: false,
          }),
        ),
    );
    const { search } = service(
      { semantic: { enabled: true, endpoint: "https://api.example.com/", key: "pk_live_abcdefgh" } },
      { fetch: fetchMock },
    );
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "we finally launched it" });
    await flush();
    expect(client.last()).toMatchObject({ status: "loading" });

    await vi.advanceTimersByTimeAsync(50);

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.example.com/v1/search");
    expect(url.searchParams.get("mode")).toBe("semantic");
    expect(url.searchParams.get("key")).toBe("pk_live_abcdefgh");
    expect(client.last()).toMatchObject({ status: "fused" });
    expect(emojis(client.last())).toContain("🚀");
  });

  it("never sends a secret key, even if one was stored", async () => {
    const { search, deps } = service({
      semantic: { enabled: true, endpoint: "https://api.example.com", key: "sk_live_secretsecret" },
    });
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "query", query: "something conceptual here" });
    await flush();
    await vi.advanceTimersByTimeAsync(50);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("records picks for the recent list", async () => {
    const { search, deps } = service();
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "picked", id: "1F680" });
    expect(deps.recordPick).toHaveBeenCalledWith("1F680");
  });

  it("ignores malformed messages", async () => {
    const { search, deps } = service();
    const client = fakePort();
    search.attach(client.port);
    client.send({ type: "picked", id: "<script>" });
    client.send({ type: "query", query: 42 });
    client.send("hello");
    await flush();
    expect(deps.recordPick).not.toHaveBeenCalled();
    expect(client.received).toHaveLength(0);
  });

  it("reports when the packs cannot load, and retries on the next open", async () => {
    const loadPacks = vi.fn().mockRejectedValueOnce(new Error("missing pack")).mockResolvedValue([en, tr]);
    const { search } = service({}, { loadPacks });
    const client = fakePort();
    search.attach(client.port);
    await flush();
    expect(client.last()).toEqual({ type: "unavailable", reason: "missing pack" });

    await expect(search.warm()).resolves.toBeDefined();
    expect(loadPacks).toHaveBeenCalledTimes(2);
  });

  it("stops answering a picker that has closed", async () => {
    const { search } = service();
    const client = fakePort();
    search.attach(client.port);
    client.disconnect();
    client.send({ type: "query", query: "rocket" });
    await flush();
    expect(client.received).toHaveLength(0);
  });
});
