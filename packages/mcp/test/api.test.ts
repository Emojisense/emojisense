import { describe, expect, it, vi } from "vitest";
import { apiFromEnv, createApiClient } from "../src/api.js";

const KEY = "sk_live_test";
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const rocket = { emoji: "🚀", id: "1F680", score: 0.8, source: "semantic" };

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? ok({ results: [] });
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("createApiClient", () => {
  it("sends the secret key as a Bearer header, never in the URL", async () => {
    const { fetch, calls } = fakeFetch(ok({ results: [rocket] }));
    const api = createApiClient({ baseUrl: "https://api.test/", secretKey: KEY, fetch });

    expect(await api.search("  Ship IT! ", { locale: "en", limit: 5 })).toEqual([rocket]);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://api.test/v1/search?q=ship+it%21&locale=en&limit=5&mode=semantic");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("posts reaction text, truncated to 256 characters", async () => {
    const { fetch, calls } = fakeFetch(ok({ results: [rocket] }));
    const api = createApiClient({ baseUrl: "https://api.test", secretKey: KEY, fetch });

    await api.suggestReactions("a".repeat(300), { locale: "tr", limit: 4 });
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://api.test/v1/suggest-reactions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "a".repeat(256), locale: "tr", limit: 4 });
  });

  it("falls back (undefined) on HTTP errors and network errors, and reports them", async () => {
    const onError = vi.fn();
    const { fetch } = fakeFetch(new Response("nope", { status: 500 }), new TypeError("fetch failed"));
    const api = createApiClient({ baseUrl: "https://api.test", secretKey: KEY, fetch, onError });

    expect(await api.search("rocket")).toBeUndefined();
    expect(await api.suggestReactions("hello")).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout", async () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: "https://api.test", secretKey: KEY, fetch, timeoutMs: 5 });
    expect(await api.search("rocket")).toBeUndefined();
  });

  it("pauses after overLimit and resumes after the cooldown", async () => {
    let time = 0;
    const { fetch, calls } = fakeFetch(ok({ results: [], overLimit: true }), ok({ results: [rocket] }));
    const api = createApiClient({
      baseUrl: "https://api.test",
      secretKey: KEY,
      fetch,
      now: () => time,
      overLimitCooldownMs: 1000,
    });

    expect(await api.search("rocket")).toBeUndefined();
    expect(await api.suggestReactions("we shipped")).toBeUndefined();
    expect(calls).toHaveLength(1);
    time = 1001;
    expect(await api.search("rocket")).toEqual([rocket]);
  });

  it("keeps only well-formed results", async () => {
    const { fetch } = fakeFetch(
      ok({
        results: [rocket, { id: 7 }, null, { id: "1F389", score: Number.NaN }, { id: "2764", score: 0.5 }],
      }),
    );
    const api = createApiClient({ baseUrl: "https://api.test", secretKey: KEY, fetch });
    expect(await api.search("rocket")).toEqual([
      rocket,
      { emoji: "", id: "2764", score: 0.5, source: "semantic" },
    ]);
  });

  it("keeps the culture source of a culture result", async () => {
    const soccer = { emoji: "⚽", id: "26BD", score: 0.6, source: "culture", context: "c", cultureId: "x" };
    const { fetch } = fakeFetch(ok({ results: [soccer] }));
    const api = createApiClient({ baseUrl: "https://api.test", secretKey: KEY, fetch });
    expect(await api.search("goat")).toEqual([{ emoji: "⚽", id: "26BD", score: 0.6, source: "culture" }]);
  });

  it("does not call the API for an empty query", async () => {
    const { fetch, calls } = fakeFetch();
    const api = createApiClient({ baseUrl: "https://api.test", secretKey: KEY, fetch });
    expect(await api.search("🚀 !!")).toBeUndefined();
    expect(await api.suggestReactions("   ")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("apiFromEnv", () => {
  it("stays offline without configuration", () => {
    const warn = vi.fn();
    expect(apiFromEnv({}, { warn })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and stays offline when only one variable is set", () => {
    const warn = vi.fn();
    expect(apiFromEnv({ EMOJISENSE_API_URL: "https://api.test" }, { warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("refuses to send a key over plain HTTP, except to localhost", () => {
    const warn = vi.fn();
    expect(
      apiFromEnv({ EMOJISENSE_API_URL: "http://api.test", EMOJISENSE_SECRET_KEY: KEY }, { warn }),
    ).toBeUndefined();
    expect(
      apiFromEnv({ EMOJISENSE_API_URL: "not a url", EMOJISENSE_SECRET_KEY: KEY }, { warn }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(
      apiFromEnv({ EMOJISENSE_API_URL: "http://localhost:8788", EMOJISENSE_SECRET_KEY: KEY }),
    ).toBeDefined();
    expect(apiFromEnv({ EMOJISENSE_API_URL: "https://api.test", EMOJISENSE_SECRET_KEY: KEY })).toBeDefined();
  });
});
