import { describe, expect, it } from "vitest";
import type { Culture } from "../src/culture.js";
import { createApiSemantic, createEngineLoader } from "../src/engine-loader.js";
import type { Pack } from "../src/pack.js";
import { en } from "./fixture.js";

const tr: Pack = { ...en, locale: "tr" };
const custom: Pack = {
  ...en,
  locale: "und",
  part: "custom",
  groups: ["custom"],
  emoji: [[":parrot:", "C-1", 0, 0, 0, "parrot", "parrot", "", "party", "", ""]],
  images: { "C-1": "https://example.com/parrot.png" },
};

const cultureFile = (locale: string): Culture => ({
  format: "emojisense-culture",
  formatVersion: 1,
  packVersion: "0.1.0",
  locale,
  from: "2026-10-02",
  until: "2027-10-03",
  entries: [],
  relevantNow: [],
});

function packFetch(files: Record<string, Pack | Culture>) {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const pack = files[url.split("/").pop() ?? ""];
    return pack ? new Response(JSON.stringify(pack)) : new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("createEngineLoader", () => {
  it("loads English and the locale, then the extension packs when idle", async () => {
    const { fetchImpl, requests } = packFetch({
      "pack.en.json": en,
      "pack.tr.json": tr,
      "pack.en.ext.json": { ...en, part: "ext" },
      "pack.tr.ext.json": { ...tr, part: "ext" },
    });
    let idle: (() => void) | undefined;
    const loader = createEngineLoader({
      packUrl: "https://packs.test/0.1.0/",
      locale: "tr",
      fetch: fetchImpl,
      whenIdle: (task) => {
        idle = task;
      },
    });
    const engine = await loader.load();
    expect(engine.locales).toEqual(["en", "tr"]);
    expect(requests).toEqual([
      "https://packs.test/0.1.0/pack.en.json",
      "https://packs.test/0.1.0/pack.tr.json",
    ]);
    const next = new Promise((resolve) => loader.subscribe(resolve));
    idle?.();
    await next;
    expect(loader.current()).not.toBe(engine);
  });

  it("falls back to English when the locale has no pack", async () => {
    const { fetchImpl } = packFetch({ "pack.en.json": en });
    const loader = createEngineLoader({
      packUrl: "https://packs.test/0.1.0",
      locale: "xx",
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    expect((await loader.load()).locales).toEqual(["en"]);
  });

  it("loads the culture file next to the packs by default", async () => {
    const { fetchImpl, requests } = packFetch({ "pack.en.json": en, "culture.en.json": cultureFile("en") });
    const loader = createEngineLoader({
      packUrl: "https://api.test/v1/pack/0.1.0",
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    expect((await loader.load()).culture?.locale).toBe("en");
    expect(requests).toContain("https://api.test/v1/culture/0.1.0/culture.en.json");
  });

  it("loads no culture file with cultureUrl: false", async () => {
    const { fetchImpl, requests } = packFetch({ "pack.en.json": en, "culture.en.json": cultureFile("en") });
    const loader = createEngineLoader({
      packUrl: "https://api.test/v1/pack/0.1.0",
      cultureUrl: false,
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    expect((await loader.load()).culture).toBeUndefined();
    expect(requests.some((url) => url.includes("culture"))).toBe(false);
  });

  it("takes the English culture file when the locale falls back to English", async () => {
    const { fetchImpl } = packFetch({ "pack.en.json": en, "culture.en.json": cultureFile("en") });
    const loader = createEngineLoader({
      packUrl: "https://api.test/v1/pack/0.1.0",
      locale: "de",
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    expect((await loader.load()).culture?.locale).toBe("en");
  });

  it("keeps working without a culture file", async () => {
    const { fetchImpl } = packFetch({ "pack.en.json": en });
    const loader = createEngineLoader({
      packUrl: "https://api.test/v1/pack/0.1.0",
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    expect((await loader.load()).culture).toBeUndefined();
  });

  it("adds extra packs, such as custom emoji, to every engine", async () => {
    const { fetchImpl } = packFetch({ "pack.en.json": en });
    const loader = createEngineLoader({
      packUrl: "https://packs.test/0.1.0",
      extraPacks: [custom],
      fetch: fetchImpl,
      whenIdle: () => {},
    });
    const engine = await loader.load();
    expect(engine.search("parrot").results[0]?.emoji).toBe(":parrot:");
  });

  it("rejects when English fails too, and can retry", async () => {
    let fail = true;
    const { fetchImpl } = packFetch({ "pack.en.json": en });
    const flaky = (async (input: RequestInfo | URL) =>
      fail ? new Response("down", { status: 500 }) : fetchImpl(input)) as typeof fetch;
    const loader = createEngineLoader({
      packUrl: "https://packs.test/0.1.0",
      fetch: flaky,
      whenIdle: () => {},
    });
    await expect(loader.load()).rejects.toThrow();
    fail = false;
    await expect(loader.load()).resolves.toBeDefined();
  });
});

describe("createApiSemantic", () => {
  it("is off without an endpoint", () => {
    expect(createApiSemantic({ packVersion: "0.1.0" })).toBeUndefined();
  });

  it("asks the shards first, then the API with the key", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ results: [], packVersion: "0.1.0", cached: false }));
    }) as typeof fetch;
    const provider = createApiSemantic({
      endpoint: "https://api.emojisense.com/",
      key: "pk_live_abcdefgh",
      packVersion: "0.1.0",
      fetch: fetchImpl,
    });
    await provider?.search("ship it", { locale: "en" });
    expect(urls[0]).toMatch(/^https:\/\/api\.emojisense\.com\/p\/0\.1\.0\//);
    expect(urls.some((url) => url.includes("/v1/search") && url.includes("key=pk_live_abcdefgh"))).toBe(true);
  });
});
