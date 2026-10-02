import { LOCALE_CODES } from "@emojisense/data/locales";
import { createEngine, type Pack, ROW_INDEX } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { parseLocale } from "../src/http.ts";
import { assetPackReader, createLocaleEngines, type PackReader } from "../src/locale-engines.ts";
import type { SearchBody } from "../src/search.ts";
// Rows of 17 emoji copied verbatim from the core packs of pack version 0.1.0 (`pnpm data:build`):
// the answers below, the fixture vectors' emoji, and what English-only aliases rank first.
import fixturePacks from "./fixtures/locale-packs.json";
import { catalog, harness, image, jpeg, KEYED, keyedSearch, ROW, reactions } from "./fixtures.ts";

const packs = fixturePacks as unknown as Record<string, Pack>;

/**
 * The ext part of a fixture locale: the same rows with no phrases, except es 🐱 "gatuno", an
 * alias its core pack does not have (ext packs hold the long tail of idioms and slang).
 */
function extOf(core: Pack): Pack {
  const blank = (row: Pack["emoji"][number]) =>
    row.map((value, i) => (i >= ROW_INDEX.label && typeof value === "string" ? "" : value));
  const emoji = core.emoji.map((row) => {
    const ext = blank(row) as Pack["emoji"][number];
    if (core.locale === "es" && row[ROW_INDEX.hexcode] === "1F431") ext[ROW_INDEX.alias] = "gatuno";
    return ext;
  });
  return { ...core, part: "ext", emoji };
}

/** Reads fixture packs like the ASSETS binding reads published ones; 404 for other locales. */
const readFixturePack: PackReader = async (file) => {
  const [, locale = "", ext] = /^pack\.(\w+)(\.ext)?\.json$/.exec(file) ?? [];
  const pack = packs[locale];
  if (!pack) throw new Error(`${file}: HTTP 404`);
  return ext ? extOf(pack) : pack;
};

/** The fixture app with real alias data: English bundled, es/hi/ar loaded on first use. */
function localeHarness(options: { read?: PackReader; maxEngines?: number } = {}) {
  const read = vi.fn(options.read ?? readFixturePack);
  const bundled = createEngine(packs.en as Pack);
  const engines = createLocaleEngines({
    bundled: () => bundled,
    base: () => [packs.en as Pack],
    read,
    maxEngines: options.maxEngines ?? 2,
  });
  const h = harness({
    catalog: { ...catalog, engine: () => bundled, aliasEngine: (locale, env) => engines.get(locale, env) },
    embedTo: ROW.neutral,
  });
  const searchBody = async (q: string, query = "") =>
    (await (await h.call(keyedSearch(q, query))).json()) as SearchBody;
  return { ...h, read, engines, searchBody };
}

describe("parseLocale", () => {
  it("accepts every pack locale", () => {
    expect(LOCALE_CODES).toHaveLength(11);
    for (const code of LOCALE_CODES) expect(parseLocale(code)).toBe(code);
  });

  it("maps BCP 47 tags to their language, ignoring case", () => {
    expect(parseLocale("en-US")).toBe("en");
    expect(parseLocale("pt-BR")).toBe("pt");
    expect(parseLocale("zh-Hans")).toBe("zh");
    expect(parseLocale("zh-Hant-TW")).toBe("zh");
    expect(parseLocale("ES")).toBe("es");
    expect(parseLocale("en_GB")).toBe("en");
  });

  it("defaults to English when no locale is given", () => {
    expect(parseLocale(null)).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("")).toBe("en");
  });

  it("rejects languages without a pack and values that are not strings", () => {
    for (const raw of ["de", "xx", "english", "-", 42, ["es"]]) expect(parseLocale(raw)).toBeUndefined();
  });
});

describe("locale parameter on the API", () => {
  it("accepts every pack locale on all three endpoints", async () => {
    const h = harness();
    for (const locale of LOCALE_CODES) {
      const found = await h.call(keyedSearch("rocket", `&locale=${locale}`));
      expect(found.status, locale).toBe(200);
      const reacted = await h.call(reactions({ text: "ship it", locale }, KEYED));
      expect(reacted.status, locale).toBe(200);
      const classified = await h.call(image(jpeg(), {}, `${KEYED}&locale=${locale}`));
      expect(classified.status, locale).toBe(200);
    }
  });

  it("answers 400 with the supported list for an unknown locale, before any metering", async () => {
    const h = harness();
    const res = await h.call(keyedSearch("rocket", "&locale=de"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'unknown locale "de": use one of en, zh, hi, es, ar, fr, bn, pt, ru, id, tr (or a BCP 47 tag of one, e.g. pt-BR)',
    );
    expect((await h.call(reactions({ text: "hi", locale: 7 }, KEYED))).status).toBe(400);
    expect((await h.call(image(jpeg(), {}, `${KEYED}&locale=xx`))).status).toBe(400);
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.events).not.toHaveBeenCalled();
  });

  it("keys the shared cache and the analytics by the parsed locale", async () => {
    const h = harness();
    await h.call(keyedSearch("lava eruption", "&locale=es-MX&mode=semantic"));
    await h.ctx.settle();
    expect(h.cache.puts).toHaveLength(1);
    expect(new URL(h.cache.puts[0] as string).searchParams.get("locale")).toBe("es");
    const spanish = (await (
      await h.call(keyedSearch("lava eruption", "&locale=es&mode=semantic"))
    ).json()) as SearchBody;
    expect(spanish.cached).toBe(true);
    const english = (await (
      await h.call(keyedSearch("lava eruption", "&locale=en&mode=semantic"))
    ).json()) as SearchBody;
    expect(english.cached).toBe(false);
    expect(h.events.mock.calls.map(([point]) => point.blobs[1])).toEqual(["es", "es", "en"]);
  });
});

describe("aliases of every pack locale", () => {
  const top = (body: SearchBody) => ({
    emoji: body.results[0]?.emoji,
    source: body.results[0]?.source,
    aliasLocale: body.aliasLocale,
  });

  it("ranks with the locale's own aliases", async () => {
    const h = localeHarness();
    expect(top(await h.searchBody("feliz cumpleaños", "&locale=es"))).toEqual({
      emoji: "🎂",
      source: "alias",
      aliasLocale: "es",
    });
    expect(top(await h.searchBody("बधाई हो", "&locale=hi"))).toEqual({
      emoji: "㊗️",
      source: "alias",
      aliasLocale: "hi",
    });
    expect(top(await h.searchBody("مبروك", "&locale=ar"))).toEqual({
      emoji: "㊗️",
      source: "alias",
      aliasLocale: "ar",
    });
    const cake = (await h.searchBody("feliz cumpleaños", "&locale=es")).results.slice(0, 2);
    expect(cake.map((r) => r.emoji)).toEqual(["🎂", "🥳"]);
  });

  it("gets the same queries wrong with English aliases alone (the old behaviour)", async () => {
    const h = localeHarness();
    const aliasHits = async (q: string) =>
      (await h.searchBody(q, "&locale=en")).results.filter((r) => r.source === "alias").map((r) => r.emoji);
    // "arabia felix" (Yemen) was the nearest English alias of "feliz". A typo match of one word
    // no longer stands for a query whose other word the dictionary does not know.
    expect(await aliasHits("feliz cumpleaños")).toEqual([]);
    expect(await aliasHits("बधाई हो")).toEqual([]);
    expect(await aliasHits("مبروك")).toEqual([]);
  });

  it("loads a pack once per isolate and shares the load between concurrent requests", async () => {
    const h = localeHarness();
    await Promise.all([1, 2, 3].map((n) => h.call(keyedSearch(`feliz cumpleaños ${n}`, "&locale=es"))));
    await h.searchBody("feliz", "&locale=es");
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.read).toHaveBeenCalledWith("pack.es.json", h.env);
    expect(h.read).toHaveBeenCalledWith("pack.es.ext.json", h.env);
    // Bundled locales never read a pack. A semantic-only search reads one only to judge a weak
    // list (assessConfidence); the neutral fake embedding has no opinion, so its list is weak.
    await h.searchBody("rocket", "&locale=en");
    expect(h.read).toHaveBeenCalledTimes(2);
    await h.searchBody("नमस्ते", "&locale=hi&mode=semantic");
    expect(h.read).toHaveBeenCalledTimes(4);
    expect(h.read).toHaveBeenCalledWith("pack.hi.json", h.env);
  });

  it("ranks with the locale's ext aliases too, as the SDK does after its idle-time load", async () => {
    const h = localeHarness();
    const body = await h.searchBody("gatuno", "&locale=es");
    expect(body.results[0]).toMatchObject({ emoji: "🐱", source: "alias" });
    expect(body.aliasLocale).toBe("es");
  });

  it("keeps at most two locale engines per isolate, dropping the least recently used", async () => {
    const h = localeHarness();
    // A new query each time: a cache hit does not rank, so it does not touch the engines.
    for (const [n, locale] of ["es", "hi", "es", "ar"].entries()) {
      await h.searchBody(`mubarak ${n}`, `&locale=${locale}`);
    }
    expect(h.engines.resident).toEqual(["es", "ar"]);
    expect(h.read).toHaveBeenCalledTimes(6);
    await h.searchBody("बधाई हो", "&locale=hi");
    expect(h.engines.resident).toEqual(["ar", "hi"]);
    expect(h.read).toHaveBeenCalledTimes(8);
  });

  it("ranks semantic-only when the pack cannot be loaded, never caches that, and retries", async () => {
    let available = false;
    const h = localeHarness({
      read: async (file, env) => {
        if (!available) throw new Error(`${file}: HTTP 404`);
        return readFixturePack(file, env);
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No concept tier: the weak semantic list would cache a concept answer.
    const res = await h.call(keyedSearch("feliz cumpleaños", "&locale=es&concept=0"));
    await h.ctx.settle();
    const body = (await res.json()) as SearchBody;
    expect(body.aliasLocale).toBeNull();
    expect(body.degraded).toBe(false);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.source === "semantic")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.cache.puts).toHaveLength(0);
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "locale_pack_unavailable",
      locale: "es",
    });
    warn.mockRestore();

    available = true;
    const retried = await h.call(keyedSearch("feliz cumpleaños", "&locale=es&concept=0"));
    await h.ctx.settle();
    expect(top((await retried.json()) as SearchBody)).toMatchObject({ emoji: "🎂", aliasLocale: "es" });
    expect(h.cache.puts).toHaveLength(1);
    expect(h.read).toHaveBeenCalledTimes(4);
  });

  it("suggests reactions with the locale's aliases, and without aliases when its pack is missing", async () => {
    const message = { text: "बधाई हो", locale: "hi" };
    const h = localeHarness();
    const reacted = (await (await h.call(reactions(message, KEYED))).json()) as SearchBody;
    expect(reacted.aliasLocale).toBe("hi");
    // The fake embedding puts 🌋 and 🚀 first; the Hindi aliases add the congratulation emoji
    // (🎊 too since हो is a hi function word and no longer dilutes बधाई).
    const aliasHits = reacted.results.filter((r) => r.source === "alias").map((r) => r.emoji);
    expect(aliasHits).toEqual(["㊗️", "🎉", "👏", "🎊"]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = localeHarness({ read: async (file) => Promise.reject(new Error(`${file}: HTTP 404`)) });
    const fallback = (await (await missing.call(reactions(message, KEYED))).json()) as SearchBody;
    warn.mockRestore();
    expect(fallback.aliasLocale).toBeNull();
    expect(fallback.results.filter((r) => r.source === "alias")).toEqual([]);
  });
});

describe("assetPackReader", () => {
  const assets = (respond: (url: string) => Response) => {
    const fetch = vi.fn(async (url: string) => respond(url));
    return { env: { ASSETS: { fetch } } satisfies Env, fetch };
  };

  it("reads the published pack of the Worker's pack version through the ASSETS binding", async () => {
    const { env, fetch } = assets(() => Response.json(packs.es));
    const pack = await assetPackReader("0.1.0")("pack.es.json", env);
    expect(pack.locale).toBe("es");
    expect(new URL(fetch.mock.calls[0]?.[0] as string).pathname).toBe("/v1/pack/0.1.0/pack.es.json");
  });

  it("refuses a missing file, another pack version, a non-pack and a missing binding", async () => {
    const read = assetPackReader("0.1.0");
    await expect(read("pack.es.json", assets(() => new Response("", { status: 404 })).env)).rejects.toThrow(
      "HTTP 404",
    );
    await expect(
      read("pack.es.json", assets(() => Response.json({ ...packs.es, packVersion: "0.0.9" })).env),
    ).rejects.toThrow("is pack 0.0.9");
    await expect(read("pack.es.json", assets(() => Response.json({ hello: 1 })).env)).rejects.toThrow(
      "not an emojisense pack",
    );
    await expect(read("pack.es.json", {})).rejects.toThrow("ASSETS binding missing");
  });
});
