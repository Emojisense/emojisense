import type { Culture } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetCultureReader,
  type CultureReader,
  createCultureFiles,
  dayIn,
  isCalendarDay,
  isRegionCode,
  parseCultureBody,
  parseCultureParams,
  utcDay,
} from "../src/culture.ts";
import type { Env } from "../src/env.ts";
import type { EdgeCaller } from "../src/region.ts";
import type { SearchBody } from "../src/search.ts";
import {
  catalog,
  culturedCatalog,
  cultureEntry,
  cultureFile,
  fromCountry,
  fromEdge,
  harness,
  keyedSearch,
  ROW,
} from "./fixtures.ts";

const shipParty = cultureEntry({
  id: "ship-it-party",
  context: "Release days come with a party",
  triggers: ["ship it"],
  emoji: [["🐶", "1F436", 0.6]],
});
const rocketDino = cultureEntry({
  id: "rocket-dino",
  kind: "regional",
  context: "In this test region, a rocket is a dinosaur",
  regions: ["GB"],
  triggers: ["rocket"],
  emoji: [["🦖", "1F996", 0.9]],
  outranks: ["1F680"],
});
const lavaWeek = cultureEntry({
  id: "lava-week",
  kind: "seasonal",
  context: "Volcano week, early October",
  when: { from: "10-01", to: "10-07", recurs: "yearly" },
  triggers: ["puppy"],
  emoji: [["🌋", "1F30B", 0.8]],
});

/** `null` = no culture file is published. */
const withCulture = (file: Culture | null = cultureFile([shipParty, rocketDino, lavaWeek])) => {
  const { catalog: cultured, read } = culturedCatalog(file);
  // A semantic tier with no opinion: the canonical top is the alias answer the entries are about.
  return { h: harness({ catalog: cultured, embedTo: ROW.neutral }), read };
};

const body = async (res: Response) => (await res.json()) as SearchBody;
const glyphs = (b: SearchBody) => b.results.map((r) => r.emoji);

afterEach(() => vi.useRealTimers());

describe("GET /v1/search with culture", () => {
  it("is on by default", async () => {
    const { h } = withCulture();
    const res = await h.call(keyedSearch("ship it"));
    const b = await body(res);
    expect(glyphs(b).slice(0, 2)).toEqual(["🚀", "🐶"]);
    expect(b.results[1]).toMatchObject({ source: "culture", cultureId: "ship-it-party" });
    expect(b.culture).toEqual({ from: "2026-10-02", day: utcDay(Date.now()), region: null });
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("is off with culture=0 or culture=false: the canonical ranking", async () => {
    const { h, read } = withCulture();
    const canonical = await body(
      await harness({ catalog: { ...catalog }, embedTo: ROW.neutral }).call(keyedSearch("ship it")),
    );
    for (const extra of ["&culture=0", "&culture=false", "&culture=0&region=GB&day=2026-10-05"]) {
      const res = await h.call(keyedSearch("ship it", extra));
      const b = await body(res);
      expect([extra, b.culture, glyphs(b)]).toEqual([extra, null, glyphs(canonical)]);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("adds culture results after the canonical top result, with context and cultureId", async () => {
    const { h } = withCulture();
    const res = await h.call(keyedSearch("ship it", "&culture=1"));
    const b = await body(res);
    expect(b.results[0]).toMatchObject({ emoji: "🚀", source: "alias" });
    expect(b.results[1]).toEqual({
      emoji: "🐶",
      id: "1F436",
      score: 0.6,
      source: "culture",
      context: "Release days come with a party",
      cultureId: "ship-it-party",
    });
    expect(b.culture).toEqual({ from: "2026-10-02", day: utcDay(Date.now()), region: null });
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("never changes the canonical top answer without a regional sense in the caller's region", async () => {
    const { h } = withCulture();
    for (const q of ["ship it", "rocket", "lava eruption", "jurassic park", "puppy", "dog"]) {
      const plain = await body(await h.call(keyedSearch(q, "&culture=0")));
      for (const extra of ["", "&culture=1", "&region=US", "&culture=1&region=FR", "&locale=en-US"]) {
        const cultured = await body(await h.call(keyedSearch(q, extra)));
        expect([q, extra, cultured.results[0]?.id]).toEqual([q, extra, plain.results[0]?.id]);
      }
    }
  });

  it("lets a regional sense lead only for a region in its list, keeping the canonical answer second", async () => {
    const { h } = withCulture();
    const gb = await body(await h.call(keyedSearch("rocket", "&culture=1&region=gb")));
    expect(glyphs(gb).slice(0, 2)).toEqual(["🦖", "🚀"]);
    expect(gb.results[0]).toMatchObject({ source: "culture", cultureId: "rocket-dino" });
    expect(gb.culture).toEqual({ from: "2026-10-02", day: utcDay(Date.now()), region: "GB" });
    expect(glyphs(await body(await h.call(keyedSearch("rocket", "&region=GB")))).slice(0, 2)).toEqual([
      "🦖",
      "🚀",
    ]);
    for (const extra of ["&culture=1&region=US", "&culture=1", "&culture=0&region=GB"]) {
      expect((await body(await h.call(keyedSearch("rocket", extra)))).results[0]?.emoji).toBe("🚀");
    }
  });

  it("applies culture after the shared cache: one cache entry for every culture and region", async () => {
    const { h } = withCulture();
    const first = await body(await h.call(keyedSearch("rocket", "&culture=1&region=GB")));
    expect(first.cached).toBe(false);
    await h.ctx.settle();
    expect(h.cache.puts).toHaveLength(1);
    expect(h.cache.puts[0]).not.toMatch(/culture|region/);
    const stored = (await h.cache.store.values().next().value?.clone().json()) as SearchBody;
    expect(stored.results.every((r) => r.source !== "culture")).toBe(true);
    expect(stored).not.toHaveProperty("culture");

    const plain = await body(await h.call(keyedSearch("rocket", "&culture=0")));
    expect(plain).toMatchObject({ cached: true, culture: null });
    expect(plain.results[0]?.emoji).toBe("🚀");
    const gb = await body(await h.call(keyedSearch("rocket", "&culture=1&region=GB")));
    expect(gb.cached).toBe(true);
    expect(glyphs(gb).slice(0, 2)).toEqual(["🦖", "🚀"]);
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("never stores culture in the shared cache with culture on by default", async () => {
    const { h } = withCulture();
    // Culture by default, and a region from the locale tag: both answers carry culture results.
    const shipped = await body(await h.call(keyedSearch("ship it")));
    expect(shipped.results.some((r) => r.source === "culture")).toBe(true);
    const gb = await body(await h.call(keyedSearch("rocket", "&locale=en-GB")));
    expect(glyphs(gb).slice(0, 2)).toEqual(["🦖", "🚀"]);
    await h.ctx.settle();
    expect(h.cache.puts).toHaveLength(2);
    for (const key of h.cache.puts) expect(key).not.toMatch(/culture|region|day|GB/);
    for (const stored of h.cache.store.values()) {
      const cached = (await stored.clone().json()) as SearchBody;
      expect(cached.results.every((r) => r.source !== "culture")).toBe(true);
      expect(cached).not.toHaveProperty("culture");
      expect(cached).not.toHaveProperty("region");
    }
    // The cached canonical answer, with the culture layer applied again per request.
    const again = await body(await h.call(keyedSearch("rocket", "&locale=en-GB")));
    expect([again.cached, glyphs(again).slice(0, 2)]).toEqual([true, ["🦖", "🚀"]]);
    const plain = await body(await h.call(keyedSearch("ship it", "&culture=0")));
    expect([plain.cached, plain.results.some((r) => r.source === "culture")]).toEqual([true, false]);
    expect(h.ai).toHaveBeenCalledTimes(2);
  });

  it("follows the culture file's windows by the UTC day when the time zone is unknown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { h } = withCulture();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    const inside = await body(await h.call(keyedSearch("puppy", "&culture=1")));
    expect(inside.results.find((r) => r.source === "culture")?.emoji).toBe("🌋");
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const after = await body(await h.call(keyedSearch("puppy", "&culture=1")));
    expect(after.results.some((r) => r.source === "culture")).toBe(false);
    expect(after.results[0]?.emoji).toBe(inside.results[0]?.emoji);
  });

  it("uses the request's UTC day near midnight, whatever the runtime's time zone", async () => {
    const zone = process.env.TZ;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // lava-week is 10-01 → 10-07. Each zone's local day differs from the UTC day at two moments.
      for (const tz of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        const { h } = withCulture();
        const seen: [string, string | undefined, boolean][] = [];
        for (const moment of [
          "2026-09-30T23:30:00Z",
          "2026-10-01T00:30:00Z",
          "2026-10-07T23:30:00Z",
          "2026-10-08T00:30:00Z",
        ]) {
          vi.setSystemTime(new Date(moment));
          const b = await body(await h.call(keyedSearch("puppy", "&culture=1")));
          seen.push([moment, b.culture?.day, b.results.some((r) => r.source === "culture")]);
        }
        expect([tz, seen]).toEqual([
          tz,
          [
            ["2026-09-30T23:30:00Z", "2026-09-30", false],
            ["2026-10-01T00:30:00Z", "2026-10-01", true],
            ["2026-10-07T23:30:00Z", "2026-10-07", true],
            ["2026-10-08T00:30:00Z", "2026-10-08", false],
          ],
        ]);
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("checks the windows against the caller's local day, from the edge's time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { h } = withCulture();
    const seen: [string, string, string | undefined, boolean][] = [];
    for (const [moment, timezone] of [
      ["2026-09-30T23:30:00Z", "Asia/Tokyo"],
      ["2026-09-30T23:30:00Z", "Mars/Olympus_Mons"],
      ["2026-10-08T00:30:00Z", "America/Los_Angeles"],
      ["2026-10-08T00:30:00Z", "Europe/Berlin"],
    ] as const) {
      vi.setSystemTime(new Date(moment));
      const b = await body(await h.call(fromEdge(keyedSearch("puppy"), { timezone })));
      seen.push([moment, timezone, b.culture?.day, b.results.some((r) => r.source === "culture")]);
    }
    // lava-week is 10-01 → 10-07. An unknown zone falls back to the UTC day.
    expect(seen).toEqual([
      ["2026-09-30T23:30:00Z", "Asia/Tokyo", "2026-10-01", true],
      ["2026-09-30T23:30:00Z", "Mars/Olympus_Mons", "2026-09-30", false],
      ["2026-10-08T00:30:00Z", "America/Los_Angeles", "2026-10-07", true],
      ["2026-10-08T00:30:00Z", "Europe/Berlin", "2026-10-08", false],
    ]);
  });

  it("takes day=YYYY-MM-DD over the caller's time zone", async () => {
    const { h } = withCulture();
    const inside = await body(
      await h.call(fromEdge(keyedSearch("puppy", "&day=2026-10-05"), { timezone: "Asia/Tokyo" })),
    );
    expect(inside.culture?.day).toBe("2026-10-05");
    expect(inside.results.find((r) => r.source === "culture")?.emoji).toBe("🌋");
    const outside = await body(await h.call(keyedSearch("puppy", "&day=2026-12-01")));
    expect(outside.culture?.day).toBe("2026-12-01");
    expect(outside.results.some((r) => r.source === "culture")).toBe(false);
  });

  it("keeps an answer for the caller's local day out of shared caches", async () => {
    const { h } = withCulture();
    const local = await h.call(fromEdge(keyedSearch("puppy"), { timezone: "Asia/Tokyo" }));
    expect(local.headers.get("cache-control")).toBe("private, max-age=3600");
    const named = await h.call(fromEdge(keyedSearch("puppy", "&day=2026-10-05"), { timezone: "Asia/Tokyo" }));
    expect(named.headers.get("cache-control")).toBe("public, max-age=3600");
    const utc = await h.call(keyedSearch("puppy"));
    expect(utc.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("rejects a day that is not a calendar day", async () => {
    const { h } = withCulture();
    for (const day of ["2026-02-30", "2026-13-01", "2026-10-5", "yesterday", "2026-10-05T10:00"]) {
      const res = await h.call(keyedSearch("puppy", `&day=${encodeURIComponent(day)}`));
      expect([day, res.status]).toEqual([day, 400]);
      expect(((await res.json()) as { error: string }).error).toMatch(
        /^day must be a calendar day as YYYY-MM-DD/,
      );
    }
  });

  it("answers without culture when the locale has no culture file", async () => {
    const { h } = withCulture(null);
    const res = await h.call(keyedSearch("ship it", "&culture=1"));
    const b = await body(res);
    expect(res.status).toBe(200);
    expect(b.culture).toBeNull();
    expect(b.results.every((r) => r.source !== "culture")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
  });

  it("with region=auto, selects regional entries by the request's country only", async () => {
    const { h } = withCulture();
    const gb = await h.call(fromCountry(keyedSearch("rocket", "&culture=1&region=auto"), "GB"));
    const gbBody = await body(gb);
    expect(glyphs(gbBody).slice(0, 2)).toEqual(["🦖", "🚀"]);
    expect(gbBody.region).toBe("GB");
    expect(gbBody.culture?.region).toBe("GB");
    // The answer depends on the caller's country, which the URL does not show.
    expect(gb.headers.get("cache-control")).toBe("private, max-age=3600");

    for (const country of ["US", "XX", "T1", undefined]) {
      const request = keyedSearch("rocket", "&culture=1&region=AUTO");
      const b = await body(await h.call(country ? fromCountry(request, country) : request));
      expect([country, b.results[0]?.emoji, b.region]).toEqual([
        country,
        "🚀",
        country === "US" ? "US" : null,
      ]);
    }
  });

  it("keeps one shared cache entry for every region=auto caller", async () => {
    const { h } = withCulture();
    await h.call(fromCountry(keyedSearch("rocket", "&culture=1&region=auto"), "GB"));
    await h.ctx.settle();
    const us = await body(await h.call(fromCountry(keyedSearch("rocket", "&culture=1&region=auto"), "US")));
    expect(us.cached).toBe(true);
    expect(h.cache.puts).toHaveLength(1);
    expect(h.cache.puts[0]).not.toMatch(/region|auto|GB|US/);
    const stored = (await h.cache.store.values().next().value?.clone().json()) as SearchBody;
    expect(stored).not.toHaveProperty("region");
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("echoes the region only when the request names one", async () => {
    const { h } = withCulture();
    expect(await body(await h.call(keyedSearch("rocket")))).not.toHaveProperty("region");
    const explicit = await h.call(keyedSearch("rocket", "&region=gb"));
    expect((await body(explicit)).region).toBe("GB");
    expect(explicit.headers.get("cache-control")).toBe("public, max-age=3600");
    const auto = await body(await h.call(fromCountry(keyedSearch("rocket", "&culture=0&region=auto"), "BR")));
    // With culture=0, auto only tells an SDK its region; the ranking stays canonical.
    expect([auto.region, auto.culture, auto.results[0]?.emoji]).toEqual(["BR", null, "🚀"]);
    // A region from the locale tag is used, not echoed: the request did not name one.
    const fromLocale = await body(await h.call(keyedSearch("rocket", "&locale=en-GB")));
    expect(fromLocale).not.toHaveProperty("region");
    expect(fromLocale.culture?.region).toBe("GB");
  });

  it("rejects an unknown culture value or a region that is not ISO 3166-1 alpha-2", async () => {
    const { h } = withCulture();
    for (const extra of [
      "&culture=yes",
      "&culture=on",
      "&culture=1&region=GBR",
      "&culture=1&region=ZZ",
      "&region=QQ",
      "&region=1",
    ]) {
      const res = await h.call(keyedSearch("rocket", extra));
      expect([extra, res.status]).toEqual([extra, 400]);
    }
    expect((await h.call(keyedSearch("rocket", "&culture=true&region= de "))).status).toBe(200);
  });
});

describe("culture parameters", () => {
  const NOW = Date.parse("2026-10-02T20:00:00Z");
  const noEdge: EdgeCaller = { country: undefined, timeZone: undefined };
  const parse = (query: string, edge = noEdge) =>
    parseCultureParams(new URL(`https://api.test/v1/search?q=x${query}`), edge, NOW);

  it("reads culture, region and day", () => {
    expect(parse("")).toEqual({
      enabled: true,
      region: undefined,
      regionRequested: false,
      auto: false,
      day: "2026-10-02",
      dayFromCaller: false,
    });
    expect(parse("&culture=1&region=br&day=2026-12-24")).toEqual({
      enabled: true,
      region: "BR",
      regionRequested: true,
      auto: false,
      day: "2026-12-24",
      dayFromCaller: false,
    });
    expect(parse("&culture=false&region=JP")).toMatchObject({ enabled: false, region: "JP" });
    expect(parse("&culture=")).toMatchObject({ enabled: true });
  });

  it("takes the region of the locale tag when the request names none", () => {
    expect(parse("&locale=pt-BR")).toMatchObject({ region: "BR", regionRequested: false, auto: false });
    expect(parse("&locale=en_us")).toMatchObject({ region: "US" });
    expect(parse("&locale=zh-Hant-TW")).toMatchObject({ region: "TW" });
    for (const locale of ["en", "es-419", "en-ZZ", "pt-XX"]) {
      expect([locale, (parse(`&locale=${locale}`) as { region?: string }).region]).toEqual([
        locale,
        undefined,
      ]);
    }
    expect(parse("&locale=pt-BR&region=PT")).toMatchObject({ region: "PT", regionRequested: true });
    expect(parse("&locale=pt-BR&region=auto")).toMatchObject({ region: undefined, auto: true });
  });

  it("takes the edge region for region=auto, and none when it is unknown", () => {
    expect(parse("&culture=1&region=auto", { country: "DE", timeZone: undefined })).toEqual({
      enabled: true,
      region: "DE",
      regionRequested: true,
      auto: true,
      day: "2026-10-02",
      dayFromCaller: false,
    });
    expect(parse("&culture=0&region=Auto")).toEqual({
      enabled: false,
      region: undefined,
      regionRequested: true,
      auto: true,
      day: "2026-10-02",
      dayFromCaller: false,
    });
  });

  it("takes the caller's local day from the edge's time zone, unless the request names a day", () => {
    const tokyo: EdgeCaller = { country: undefined, timeZone: "Asia/Tokyo" };
    expect(parse("", tokyo)).toMatchObject({ day: "2026-10-03" });
    expect(parse("&day=2026-10-01", tokyo)).toMatchObject({ day: "2026-10-01" });
    expect(parse("", { country: undefined, timeZone: "Not/A_Zone" })).toMatchObject({ day: "2026-10-02" });
  });

  it("reads the same fields from a reactions body, culture as a boolean", () => {
    const edge: EdgeCaller = { country: "JP", timeZone: "Asia/Tokyo" };
    expect(parseCultureBody({}, edge, NOW)).toEqual({
      enabled: true,
      region: undefined,
      regionRequested: false,
      auto: false,
      day: "2026-10-03",
      dayFromCaller: true,
    });
    expect(parseCultureBody({ culture: false, region: "auto", day: "2026-01-01" }, edge, NOW)).toEqual({
      enabled: false,
      region: "JP",
      regionRequested: true,
      auto: true,
      day: "2026-01-01",
      dayFromCaller: false,
    });
    expect(parseCultureBody({ culture: null, locale: "ja-JP" }, edge, NOW)).toMatchObject({
      enabled: true,
      region: "JP",
      regionRequested: false,
    });
    for (const input of [
      { culture: "1" },
      { culture: 0 },
      { region: 42 },
      { region: "Japan" },
      { day: 20261003 },
    ]) {
      const result = parseCultureBody(input, edge, NOW);
      expect([input, result instanceof Response && result.status]).toEqual([input, 400]);
    }
  });

  it("knows calendar days and the day of a time zone", () => {
    expect(["2024-02-29", "2026-12-31"].every(isCalendarDay)).toBe(true);
    expect(["2025-02-29", "2026-04-31", "2026-1-01", "20261003", ""].some(isCalendarDay)).toBe(false);
    const moment = Date.parse("2026-10-08T00:30:00Z");
    expect(dayIn("America/Los_Angeles", moment)).toBe("2026-10-07");
    expect(dayIn("Pacific/Kiritimati", moment)).toBe("2026-10-08");
    expect(dayIn(undefined, moment)).toBe("2026-10-08");
    expect(dayIn("Nowhere/Land", moment)).toBe("2026-10-08");
  });

  it("knows real regions only", () => {
    expect(isRegionCode("TW")).toBe(true);
    expect(isRegionCode("XX")).toBe(false);
    expect(isRegionCode("ZZ")).toBe(false);
    expect(isRegionCode("gb")).toBe(false);
  });
});

describe("culture files per isolate", () => {
  const env = {} as Env;
  const file = cultureFile([shipParty]);

  it("loads a locale once per UTC day and reads it again the next day", async () => {
    let now = Date.parse("2026-10-02T23:00:00Z");
    const read = vi.fn<CultureReader>(async () => file);
    const files = createCultureFiles({ read, now: () => now });
    await Promise.all([files.get("en", env), files.get("en", env)]);
    expect(await files.get("en", env)).toBe(file);
    expect(read).toHaveBeenCalledTimes(1);
    now = Date.parse("2026-10-03T00:30:00Z");
    await files.get("en", env);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("remembers a missing file for the day, but retries a failed load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = vi.fn<CultureReader>(async () => undefined);
    const files = createCultureFiles({ read: missing });
    expect(await files.get("tr", env)).toBeUndefined();
    await files.get("tr", env);
    expect(missing).toHaveBeenCalledTimes(1);

    const failing = vi.fn<CultureReader>(async () => {
      throw new Error("HTTP 500");
    });
    const flaky = createCultureFiles({ read: failing });
    expect(await flaky.get("en", env)).toBeUndefined();
    await flaky.get("en", env);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"culture_file_unavailable"'));
    warn.mockRestore();
  });

  it("refuses a file of another locale and warns when a file is past its last day", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrong = createCultureFiles({ read: async () => cultureFile([], "es") });
    expect(await wrong.get("en", env)).toBeUndefined();
    const stale = createCultureFiles({
      read: async () => file,
      now: () => Date.parse("2026-11-20T10:00:00Z"),
    });
    expect(await stale.get("en", env)).toBe(file);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"culture_file_stale"'));
    warn.mockRestore();
  });

  it("reads the published files through ASSETS", async () => {
    const urls: string[] = [];
    const assets = (status: number, value: unknown) => ({
      ASSETS: {
        fetch: async (url: string) => {
          urls.push(url);
          return new Response(JSON.stringify(value), { status });
        },
      },
    });
    const read = assetCultureReader("test");
    expect(await read("culture.en.json", assets(200, file))).toEqual(file);
    expect(urls[0]).toBe("https://assets.local/v1/culture/test/culture.en.json");
    expect(await read("culture.en.json", assets(404, {}))).toBeUndefined();
    await expect(read("culture.en.json", assets(200, { ...file, packVersion: "0.0.9" }))).rejects.toThrow(
      "is pack 0.0.9",
    );
    await expect(read("culture.en.json", assets(200, { nope: true }))).rejects.toThrow(
      "not an emojisense culture",
    );
    await expect(read("culture.en.json", {})).rejects.toThrow("ASSETS binding missing");
  });
});
