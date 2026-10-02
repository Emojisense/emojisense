import type { HostedEmojiSet, Pack } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import type { Env } from "../src/env.ts";
import packEn from "../src/generated/pack.en.json";
import { createSetCatalog } from "../src/sets/catalog.ts";
import { IMMUTABLE, MAX_SET_SVG_BYTES } from "../src/sets/route.ts";
import generated from "../src/sets/upstreams.json";
import { createUpstreamResolver, UPSTREAMS, type UpstreamData } from "../src/sets/upstreams.ts";
import { API, catalog, executionContext, memoryCache } from "./fixtures.ts";

const rows = (packEn as unknown as Pack).emoji;
const data = generated as UpstreamData;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"/>';
const svg = (body: BodyInit = SVG, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "image/svg+xml", ...headers } });

/** The app with the real pack and upstreams.json, a fake upstream, and limiters that refuse all. */
function setsHarness(respond: (url: string) => Response | Promise<Response> = () => svg()) {
  const upstream = vi.fn(async (input: RequestInfo | URL) => respond(String(input)));
  const cache = memoryCache();
  const ctx = executionContext();
  const limiter = { limit: vi.fn(async () => ({ success: false })) };
  const env: Env = { ANON_LIMITER: limiter, SEARCH_LIMITER: limiter };
  const app = createApp({
    catalog,
    cache: () => cache,
    emojiSets: { rows: () => rows, fetch: upstream as unknown as typeof fetch },
  });
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`${API}${path}`, init), env, ctx);
  return { upstream, cache, ctx, limiter, call };
}

const jsdelivr = (set: HostedEmojiSet, path: string) =>
  `https://cdn.jsdelivr.net/gh/${UPSTREAMS[set].repo}@${UPSTREAMS[set].commit}/${path}`;

describe("GET /v1/sets/:set/:hexcode.svg", () => {
  it("serves the pinned upstream file as an immutable SVG, without a key or rate limit", async () => {
    const h = setsHarness();
    const res = await h.call("/v1/sets/twemoji/1F600.svg");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SVG);
    expect(h.upstream).toHaveBeenCalledWith(jsdelivr("twemoji", "assets/svg/1f600.svg"), expect.anything());
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "image/svg+xml",
      "cache-control": IMMUTABLE,
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      link: '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
    });
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.limiter.limit).not.toHaveBeenCalled();
  });

  it("fetches each file once and serves every spelling of the hexcode from the cache", async () => {
    const h = setsHarness();
    await h.call("/v1/sets/noto/0023-FE0F-20E3.svg");
    await h.ctx.settle();
    expect(h.cache.puts).toEqual([`${API}/v1/sets/noto/0023-FE0F-20E3.svg?pin=e20cbc2bbec1`]);
    for (const spelling of ["0023-20E3", "23-20e3", "0023-fe0f-20e3"]) {
      const res = await h.call(`/v1/sets/noto/${spelling}.svg`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    }
    expect(h.upstream).toHaveBeenCalledTimes(1);
    expect(h.upstream).toHaveBeenCalledWith(
      jsdelivr("noto", "2D/svg/emoji_u0023_20e3.svg"),
      expect.anything(),
    );
  });

  it("encodes Fluent folder names and serves the requested skin tone", async () => {
    const h = setsHarness();
    expect((await h.call("/v1/sets/fluent/1F44D-1F3FD.svg")).status).toBe(200);
    expect(h.upstream).toHaveBeenCalledWith(
      jsdelivr("fluent", "assets/Thumbs%20up/Medium/Flat/thumbs_up_flat_medium.svg"),
      expect.anything(),
    );
  });

  it.each([
    ["/v1/sets/openmoji/1F600.svg", 404, "unknown_set"],
    ["/v1/sets/native/1F600.svg", 404, "unknown_set"],
    ["/v1/sets/Twemoji/1F600.svg", 404, "unknown_set"],
    ["/v1/sets/__proto__/1F600.svg", 404, "unknown_set"],
    ["/v1/sets/twemoji", 404, "not_found"],
    ["/v1/sets/twemoji/", 404, "not_found"],
    ["/v1/sets/twemoji/assets/1F600.svg", 404, "not_found"],
    ["/v1/sets/twemoji/1F600.png", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/1F600", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/.svg", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/1F600--1F3FB.svg", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/110000.svg", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/1234567.svg", 400, "invalid_hexcode"],
    [`/v1/sets/twemoji/${Array(17).fill("1F600").join("-")}.svg`, 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/..%2F..%2Fpackage.json%23.svg", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/https:%2F%2Fevil.test%2Fx.svg", 400, "invalid_hexcode"],
    ["/v1/sets/twemoji/0041.svg", 404, "unknown_emoji"],
    ["/v1/sets/twemoji/1F1E6.svg", 404, "unknown_emoji"],
    ["/v1/sets/twemoji/1F600-1F3FB.svg", 404, "unknown_emoji"],
    ["/v1/sets/twemoji/1F9D1-1F3FB-200D-1F91D-200D-1F9D1-1F3FC.svg", 404, "unknown_emoji"],
    ["/v1/sets/fluent/1F1FA-1F1F8.svg", 404, "not_in_set"],
    ["/v1/sets/fluent/1F91D-1F3FB.svg", 404, "not_in_set"],
  ])("%s → %i %s, without an upstream request", async (path, status, code) => {
    const h = setsHarness();
    const res = await h.call(path);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: code, message: expect.any(String) });
    expect(h.upstream).not.toHaveBeenCalled();
    if (status === 404 && code !== "not_found") {
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    }
  });

  it("accepts GET only", async () => {
    const res = await setsHarness().call("/v1/sets/twemoji/1F600.svg", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
  });

  it.each([
    ["an upstream error", () => new Response("", { status: 503 })],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a non-SVG answer", () => new Response("<html>", { headers: { "content-type": "text/html" } })],
    ["an oversized SVG", () => svg("x", { "content-length": String(MAX_SET_SVG_BYTES + 1) })],
  ])("answers 502 and caches nothing for %s", async (_, respond) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = setsHarness(respond);
    const res = await h.call("/v1/sets/twemoji/1F600.svg");
    await h.ctx.settle();
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.cache.puts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"set_upstream_failed"'));
    warn.mockRestore();
  });

  it("answers an unexpected upstream 404 as not_in_set, uncached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = setsHarness(() => new Response("Couldn't find the requested file", { status: 404 }));
    const res = await h.call("/v1/sets/twemoji/1F600.svg");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    warn.mockRestore();
  });
});

describe("hosted set mapping", () => {
  const sets = createSetCatalog(rows);
  const resolve = createUpstreamResolver(data);
  const pathOf = (set: HostedEmojiSet, hexcode: string) => {
    const entry = sets.find(hexcode);
    if (!entry) throw new Error(`${hexcode} is not in the catalog`);
    return resolve(set, entry);
  };

  it.each([
    // ZWJ sequences, with and without U+FE0F
    [
      "1F469-200D-1F4BB",
      "1f469-200d-1f4bb",
      "2D/svg/emoji_u1f469_200d_1f4bb",
      "Woman technologist/Default/Flat/woman_technologist_flat_default",
    ],
    [
      "2764-FE0F-200D-1F525",
      "2764-fe0f-200d-1f525",
      "2D/svg/emoji_u2764_200d_1f525",
      "Heart on fire/Flat/heart_on_fire_flat",
    ],
    [
      "1F441-FE0F-200D-1F5E8-FE0F",
      "1f441-200d-1f5e8",
      "2D/svg/emoji_u1f441_200d_1f5e8",
      "Eye in speech bubble/Flat/eye_in_speech_bubble_flat",
    ],
    // Skin tones, including ZWJ sequences and two people with one tone
    [
      "1F44D-1F3FD",
      "1f44d-1f3fd",
      "2D/svg/emoji_u1f44d_1f3fd",
      "Thumbs up/Medium/Flat/thumbs_up_flat_medium",
    ],
    [
      "1F3CC-1F3FB-200D-2642-FE0F",
      "1f3cc-1f3fb-200d-2642-fe0f",
      "2D/svg/emoji_u1f3cc_1f3fb_200d_2642",
      "Man golfing/Light/Flat/man_golfing_flat_light",
    ],
    [
      "1F9D1-1F3FE-200D-1F91D-200D-1F9D1-1F3FE",
      "1f9d1-1f3fe-200d-1f91d-200d-1f9d1-1f3fe",
      "2D/svg/emoji_u1f9d1_1f3fe_200d_1f91d_200d_1f9d1_1f3fe",
      undefined,
    ],
    // Flags: country, subdivision, ZWJ
    ["1F1FA-1F1F8", "1f1fa-1f1f8", "third_party/region-flags/waved-svg/emoji_u1f1fa_1f1f8", undefined],
    [
      "1F3F4-E0067-E0062-E0065-E006E-E0067-E007F",
      "1f3f4-e0067-e0062-e0065-e006e-e0067-e007f",
      "third_party/region-flags/waved-svg/emoji_u1f3f4_e0067_e0062_e0065_e006e_e0067_e007f",
      undefined,
    ],
    [
      "1F3F3-FE0F-200D-1F308",
      "1f3f3-fe0f-200d-1f308",
      "2D/svg/emoji_u1f3f3_200d_1f308",
      "Rainbow flag/Flat/rainbow_flag_flat",
    ],
    // Keycaps and text-default symbols
    ["0023-FE0F-20E3", "23-20e3", "2D/svg/emoji_u0023_20e3", "Keycap hashtag/Flat/keycap_hashtag_flat"],
    ["0031-FE0F-20E3", "31-20e3", "2D/svg/emoji_u0031_20e3", "Keycap 1/Flat/keycap_1_flat"],
    ["2764", "2764", "2D/svg/emoji_u2764", "Red heart/Flat/red_heart_flat"],
  ])("%s → twemoji %s, noto %s, fluent %s", (hexcode, twemoji, noto, fluent) => {
    expect(pathOf("twemoji", hexcode)).toBe(`assets/svg/${twemoji}.svg`);
    expect(pathOf("noto", hexcode)).toBe(`${noto}.svg`);
    expect(pathOf("fluent", hexcode)).toBe(fluent && `assets/${fluent}.svg`);
  });

  it("has the five single-tone variants of every emoji with skin tones", () => {
    const toned = rows.filter((row) => row[4] === 1).length;
    expect(sets.all).toHaveLength(rows.length + toned * 5);
    expect(sets.find("1f44d-1f3ff")?.hexcode).toBe("1F44D-1F3FF");
  });

  it("was generated for the pinned commits and accounts for every emoji", () => {
    for (const set of Object.keys(UPSTREAMS) as HostedEmojiSet[]) {
      expect(data[set].commit).toBe(UPSTREAMS[set].commit);
      for (const entry of sets.all) {
        const path = resolve(set, entry);
        expect(path === undefined).toBe(entry.hexcode in data[set].missing);
      }
    }
  });
});
