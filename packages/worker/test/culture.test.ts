import type { Culture, CultureEntry } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetCultureReader,
  type CultureReader,
  createCultureFiles,
  isRegionCode,
  parseCultureParams,
  utcDay,
} from "../src/culture.ts";
import type { Env } from "../src/env.ts";
import type { SearchBody } from "../src/search.ts";
import type { Catalog } from "../src/semantic.ts";
import { catalog, harness, keyedSearch } from "./fixtures.ts";

const entry = (overrides: Partial<CultureEntry> & Pick<CultureEntry, "id">): CultureEntry => ({
  kind: "lasting",
  context: "Context",
  when: null,
  regions: ["*"],
  triggers: [],
  emoji: [],
  ...overrides,
});

const cultureFile = (entries: CultureEntry[], locale = "en"): Culture => ({
  format: "emojisense-culture",
  formatVersion: 1,
  packVersion: "test",
  locale,
  from: "2026-10-02",
  until: "2026-10-16",
  entries,
  relevantNow: [],
});

const shipParty = entry({
  id: "ship-it-party",
  context: "Release days come with a party",
  triggers: ["ship it"],
  emoji: [["🐶", "1F436", 0.6]],
});
const rocketDino = entry({
  id: "rocket-dino",
  kind: "regional",
  context: "In this test region, a rocket is a dinosaur",
  regions: ["GB"],
  triggers: ["rocket"],
  emoji: [["🦖", "1F996", 0.9]],
  outranks: ["1F680"],
});
const lavaWeek = entry({
  id: "lava-week",
  kind: "seasonal",
  context: "Volcano week, early October",
  when: { from: "10-01", to: "10-07", recurs: "yearly" },
  triggers: ["puppy"],
  emoji: [["🌋", "1F30B", 0.8]],
});

/** `null` = no culture file is published. */
const withCulture = (file: Culture | null = cultureFile([shipParty, rocketDino, lavaWeek])) => {
  const read = vi.fn(async (locale: string) => (locale === "en" ? (file ?? undefined) : undefined));
  const cultured: Catalog = { ...catalog, culture: read };
  return { h: harness({ catalog: cultured }), read };
};

const body = async (res: Response) => (await res.json()) as SearchBody;
const glyphs = (b: SearchBody) => b.results.map((r) => r.emoji);

afterEach(() => vi.useRealTimers());

describe("GET /v1/search with culture", () => {
  it("is off by default", async () => {
    const { h, read } = withCulture();
    const res = await body(await h.call(keyedSearch("ship it")));
    expect(res.culture).toBeNull();
    expect(res.results.every((r) => r.source !== "culture")).toBe(true);
    expect(read).not.toHaveBeenCalled();
    const off = await body(
      await harness({ catalog: { ...catalog } }).call(keyedSearch("ship it", "&culture=0")),
    );
    expect(glyphs(off)).toEqual(glyphs(res));
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
      const plain = await body(await h.call(keyedSearch(q)));
      for (const extra of ["&culture=1", "&culture=1&region=US", "&culture=1&region=FR"]) {
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
    for (const extra of ["&culture=1&region=US", "&culture=1", "&region=GB"]) {
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

    const plain = await body(await h.call(keyedSearch("rocket")));
    expect(plain).toMatchObject({ cached: true, culture: null });
    expect(plain.results[0]?.emoji).toBe("🚀");
    const gb = await body(await h.call(keyedSearch("rocket", "&culture=1&region=GB")));
    expect(gb.cached).toBe(true);
    expect(glyphs(gb).slice(0, 2)).toEqual(["🦖", "🚀"]);
    expect(h.ai).toHaveBeenCalledTimes(1);
  });

  it("follows the culture file's windows by the server's UTC day", async () => {
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
          const b = await body(await h.call(search("puppy", "&culture=1")));
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

  it("answers without culture when the locale has no culture file", async () => {
    const { h } = withCulture(null);
    const res = await h.call(keyedSearch("ship it", "&culture=1"));
    const b = await body(res);
    expect(res.status).toBe(200);
    expect(b.culture).toBeNull();
    expect(b.results.every((r) => r.source !== "culture")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
  });

  it("rejects an unknown culture value or a region that is not ISO 3166-1 alpha-2", async () => {
    const { h } = withCulture();
    for (const extra of [
      "&culture=yes",
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
  const parse = (query: string) => parseCultureParams(new URL(`https://api.test/v1/search?q=x${query}`));

  it("reads culture and region", () => {
    expect(parse("")).toEqual({ enabled: false, region: undefined });
    expect(parse("&culture=1&region=br")).toEqual({ enabled: true, region: "BR" });
    expect(parse("&culture=false&region=JP")).toEqual({ enabled: false, region: "JP" });
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
