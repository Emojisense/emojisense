import { describe, expect, it, vi } from "vitest";
import { createApiProvider } from "../src/lib/semantic";

const body = {
  results: [{ emoji: "🚀", id: "1F680", score: 0.8, source: "semantic" }],
  packVersion: "test",
  cached: false,
};

function recordingFetch(response: () => Promise<Response> = async () => new Response(JSON.stringify(body))) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return response();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("createApiProvider", () => {
  it("is offline without an API URL", () => {
    expect(createApiProvider({})).toEqual({});
    expect(createApiProvider({ apiKey: "sk_live_x" }).warning).toMatch(/URL is empty/);
  });

  it("refuses invalid and non-https URLs", () => {
    expect(createApiProvider({ apiUrl: "nope" }).warning).toMatch(/not a valid URL/);
    expect(createApiProvider({ apiUrl: "http://api.example.com" }).warning).toMatch(/https/);
    expect(createApiProvider({ apiUrl: "http://localhost:8788" }).provider).toBeDefined();
  });

  it("sends a secret key as a Bearer header and keeps it out of the URL", async () => {
    const { fetch, calls } = recordingFetch();
    const { provider } = createApiProvider(
      { apiUrl: "https://api.test/", apiKey: "sk_live_secret" },
      { fetch },
    );
    const response = await provider?.search("ship it", { locale: "en", limit: 5 });

    expect(response?.results[0]?.emoji).toBe("🚀");
    const [call] = calls;
    // culture=0: the session applies the culture layer on the device, after fusion.
    expect(call?.url).toBe("https://api.test/v1/search?q=ship+it&locale=en&limit=5&mode=semantic&culture=0");
    expect(call?.headers.get("Authorization")).toBe("Bearer sk_live_secret");
  });

  it("sends a publishable key as a query parameter, like a browser", async () => {
    const { fetch, calls } = recordingFetch();
    const { provider } = createApiProvider(
      { apiUrl: "https://api.test", apiKey: "pk_live_public", packVersion: "0.1.0" },
      { fetch },
    );
    await provider?.search("ship it");

    // The API host's shards first, then the API.
    expect(calls[0]?.url).toBe("https://api.test/p/0.1.0/index.json");
    const search = calls.find((call) => call.url.includes("/v1/search"));
    expect(search?.url).toContain("pack=0.1.0");
    expect(search?.url).toContain("key=pk_live_public");
    expect(search?.headers.get("Authorization")).toBeNull();
  });

  it("aborts a slow request after the timeout", async () => {
    const fetch = ((_input: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof globalThis.fetch;
    const { provider } = createApiProvider({ apiUrl: "https://api.test" }, { fetch, timeoutMs: 5 });
    await expect(provider?.search("ship it")).rejects.toThrow();
  });
});
