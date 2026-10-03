import type { AliasEngine } from "emojisense";
import { describe, expect, it } from "vitest";
import { pickerAttributes, readConfig } from "../../src/lib/config.js";
import { createEngineLoader, semanticProvider } from "../../src/lib/engine.js";
import { packFetch } from "./fixtures.js";

const base = readConfig({
  packUrl: "https://site.test/wp-content/plugins/emojisense/packs/0.1.0",
  locale: "tr",
});

describe("createEngineLoader", () => {
  it("loads the core packs from the site, then the extension packs when idle", async () => {
    const { fetchImpl, requests } = packFetch();
    let idle: (() => void) | undefined;
    const loader = createEngineLoader({ config: base, fetch: fetchImpl, whenIdle: (task) => (idle = task) });
    const seen: AliasEngine[] = [];
    loader.subscribe((engine) => seen.push(engine));

    const engine = await loader.load();
    expect(loader.current()).toBe(engine);
    expect(engine.locales).toEqual(["en", "tr"]);
    expect(requests.map((url) => url.split("/").pop())).toEqual(["pack.en.json", "pack.tr.json"]);
    expect(requests.every((url) => url.startsWith("https://site.test/"))).toBe(true);

    idle?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.map((url) => url.split("/").pop())).toContain("pack.tr.ext.json");
    expect(seen).toHaveLength(2);
    expect(loader.current()).toBe(seen[1]);
  });

  it("loads once for many callers", async () => {
    const { fetchImpl, requests } = packFetch();
    const loader = createEngineLoader({ config: base, fetch: fetchImpl, whenIdle: () => {} });
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBe(b);
    expect(requests).toHaveLength(2);
  });

  it("can retry after a failed load", async () => {
    let fail = true;
    const { fetchImpl } = packFetch();
    const flaky = (async (input: RequestInfo | URL) =>
      fail ? new Response("nope", { status: 500 }) : fetchImpl(input)) as typeof fetch;
    const loader = createEngineLoader({ config: base, fetch: flaky, whenIdle: () => {} });
    await expect(loader.load()).rejects.toThrow();
    fail = false;
    await expect(loader.load()).resolves.toBeDefined();
  });

  it("loads no culture file when the site turned culture off, also from the API's packs", async () => {
    const { fetchImpl, requests } = packFetch();
    const config = { ...base, packUrl: "https://api.emojisense.com/v1/pack/0.1.0", cultureUrl: "" };
    const loader = createEngineLoader({ config, fetch: fetchImpl, whenIdle: () => {} });
    expect((await loader.load()).culture).toBeUndefined();
    expect(requests.some((url) => url.includes("/culture/"))).toBe(false);
  });

  it("works without the culture file", async () => {
    const { fetchImpl } = packFetch();
    const config = { ...base, cultureUrl: "https://site.test/missing" };
    const loader = createEngineLoader({ config, fetch: fetchImpl, whenIdle: () => {} });
    const engine = await loader.load();
    expect(engine.culture).toBeUndefined();
  });
});

describe("semanticProvider", () => {
  it("is off without an endpoint (search by meaning off)", () => {
    expect(semanticProvider(base, "0.1.0")).toBeUndefined();
  });

  it("keeps one provider per config and pack version, so loaded shards stay loaded", () => {
    const config = { ...base, endpoint: "https://api.emojisense.com", key: "pk_live_abcdefgh" };
    expect(semanticProvider(config, "0.1.0")).toBe(semanticProvider(config, "0.1.0"));
    expect(semanticProvider(config, "0.2.0")).not.toBe(semanticProvider(config, "0.1.0"));
  });

  it("sends the publishable key and the pack version", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ results: [], packVersion: "0.1.0", cached: false }), {
        status: 200,
      });
    }) as typeof fetch;
    const provider = semanticProvider(
      { ...base, endpoint: "https://api.emojisense.com", key: "pk_live_abcdefgh" },
      "0.1.0",
      fetchImpl,
    );
    await provider?.search("ship it", { locale: "tr" });
    // The API host's shards of the locale first, then the API.
    expect(urls[0]).toBe("https://api.emojisense.com/p/0.1.0/tr/index.json");
    const url = new URL(urls.find((u) => u.includes("/v1/search")) ?? "");
    expect(url.origin + url.pathname).toBe("https://api.emojisense.com/v1/search");
    expect(url.searchParams.get("key")).toBe("pk_live_abcdefgh");
    expect(url.searchParams.get("pack")).toBe("0.1.0");
    expect(url.searchParams.get("locale")).toBe("tr");
  });
});

describe("pickerAttributes", () => {
  it("keeps the picker offline and native without an endpoint", () => {
    const attributes = pickerAttributes({ ...base, emojiSet: "noto" }, "Search");
    expect(attributes).toEqual({
      "pack-url": base.packUrl,
      locale: "tr",
      "emoji-set": "native",
      "culture-url": "off",
      placeholder: "Search",
    });
  });

  it("adds the endpoint, key, set and culture when configured", () => {
    const attributes = pickerAttributes({
      ...base,
      endpoint: "https://api.emojisense.com",
      key: "pk_live_abcdefgh",
      emojiSet: "noto",
      cultureUrl: "https://api.emojisense.com/v1/culture/0.1.0",
    });
    expect(attributes).toMatchObject({
      endpoint: "https://api.emojisense.com",
      "publishable-key": "pk_live_abcdefgh",
      "emoji-set": "noto",
      "culture-url": "https://api.emojisense.com/v1/culture/0.1.0",
    });
  });
});
