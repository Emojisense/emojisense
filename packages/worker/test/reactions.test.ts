import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiCultureResult, utcDay } from "../src/culture.ts";
import { truncateText } from "../src/reactions.ts";
import type { SearchBody } from "../src/search.ts";
import {
  API,
  culturedCatalog,
  cultureEntry,
  cultureFile,
  EMBEDDING_MODEL,
  fromCountry,
  fromEdge,
  harness,
  KEYED,
  ROW,
  reactions,
} from "./fixtures.ts";

describe("POST /v1/suggest-reactions", () => {
  it("ranks alias and semantic results for a whole message", async () => {
    const h = harness();
    const res = await h.call(reactions({ text: "ship it!" }, KEYED));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ cached: false, degraded: false, overLimit: false, packVersion: "test" });
    const sources = new Set(body.results.map((r) => r.source));
    expect(sources).toEqual(new Set(["alias", "semantic"]));
    expect(body.results.some((r) => r.emoji === "🚀" && r.source === "alias")).toBe(true);
    expect(body.results.length).toBeLessThanOrEqual(8);
    expect(h.ai).toHaveBeenCalledWith(EMBEDDING_MODEL, {
      text: ["ship it!"],
    });
  });

  it("cuts the text to 256 characters before it reaches the model", async () => {
    const h = harness();
    await h.call(reactions({ text: `${"🎉".repeat(300)} tail` }, KEYED));
    const input = h.ai.mock.calls[0]?.[1] as { text: string[] } | undefined;
    const text = input?.text[0] ?? "";
    expect(Array.from(text)).toHaveLength(256);
    expect(text).not.toContain("tail");
    // Whole emoji only: a split surrogate pair would show up as a different element.
    expect(new Set(Array.from(text))).toEqual(new Set(["🎉"]));
  });

  it("never caches or logs the text", async () => {
    const h = harness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "my salary is 123456";
    const res = await h.call(reactions({ text: secret }, KEYED));
    h.env.AI = { run: async () => Promise.reject(new Error(`model failed on: ${secret}`)) };
    await h.call(reactions({ text: secret }, KEYED));
    await h.ctx.settle();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.cache.puts).toEqual([]);
    expect(h.events).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify([h.events.mock.calls, warn.mock.calls]);
    expect(logged).not.toContain("salary");
    expect(h.events.mock.calls[0]?.[0].blobs).toEqual(["", "en", "hybrid", "miss", "reactions"]);
    warn.mockRestore();
  });

  it("validates the request", async () => {
    const h = harness();
    expect((await h.call(reactions("not json"))).status).toBe(400);
    expect((await h.call(reactions({ text: "   " }))).status).toBe(400);
    expect((await h.call(reactions({ text: 42 }))).status).toBe(400);
    expect((await h.call(reactions({ text: "x".repeat(20_000) }))).status).toBe(413);
    expect((await h.call(new Request(`${API}/v1/suggest-reactions`))).status).toBe(405);
  });

  it("answers anonymous callers with aliases only, without the embedding call", async () => {
    const h = harness();
    const res = await h.call(reactions({ text: "ship it!" }));
    const body = (await res.json()) as SearchBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ overLimit: true, degraded: false, aliasLocale: "en" });
    expect(body.results.some((r) => r.emoji === "🚀")).toBe(true);
    expect(body.results.every((r) => r.source === "alias")).toBe(true);
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.events.mock.calls[0]?.[0].blobs).toEqual(["", "en", "hybrid", "anonymous", "reactions"]);
  });

  it("honours locale and limit", async () => {
    const body = (await (
      await harness().call(reactions({ text: "rocket launch", locale: "tr", limit: 2 }, KEYED))
    ).json()) as SearchBody;
    expect(body.results).toHaveLength(2);
  });
});

describe("POST /v1/suggest-reactions with culture", () => {
  // Like thanks-bow-jp (🙏 then 🙇 for "thanks" in Japan), with an emoji of the fixture pack.
  const shipBowJp = cultureEntry({
    id: "ship-bow-jp",
    context: "In this test, Japan bows to a release",
    regions: ["JP"],
    triggers: ["ship it"],
    emoji: [["🌋", "1F30B", 0.7]],
  });
  const lavaWeekJp = cultureEntry({
    id: "lava-week-jp",
    kind: "seasonal",
    context: "Volcano week, early October",
    when: { from: "10-01", to: "10-07", recurs: "yearly" },
    regions: ["JP"],
    triggers: ["puppy"],
    emoji: [["🦖", "1F996", 0.8]],
  });
  const setup = () => {
    const { catalog, read } = culturedCatalog(cultureFile([shipBowJp, lavaWeekJp]));
    return { h: harness({ catalog, embedTo: ROW.neutral }), read };
  };
  const MESSAGE = "time to ship it, thanks all!";
  const call = async (h: ReturnType<typeof setup>["h"], input: object, edit = (r: Request) => r) => {
    const res = await h.call(edit(reactions({ text: MESSAGE, ...input }, KEYED)));
    return { res, body: (await res.json()) as SearchBody };
  };
  const cultureRows = (body: SearchBody) =>
    body.results.filter((r): r is ApiCultureResult => r.source === "culture");

  afterEach(() => vi.useRealTimers());

  it("puts the culture emoji of the caller's region right after the top reaction, by default", async () => {
    const { h } = setup();
    const canonical = (await call(h, { culture: false })).body;
    const { res, body } = await call(h, { region: "jp" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.results[0]).toEqual(canonical.results[0]);
    expect(body.results[1]).toEqual({
      emoji: "🌋",
      id: "1F30B",
      score: 0.7,
      source: "culture",
      context: "In this test, Japan bows to a release",
      cultureId: "ship-bow-jp",
    });
    expect(body.results.slice(2)).toEqual(canonical.results.slice(1).filter((r) => r.id !== "1F30B"));
    expect(body.culture).toEqual({ from: "2026-10-02", day: utcDay(Date.now()), region: "JP" });
    expect(body.region).toBe("JP");
    expect(h.cache.puts).toEqual([]);
  });

  it("applies no regional entry without a region, and none with culture: false", async () => {
    const { h, read } = setup();
    const none = (await call(h, {})).body;
    expect(cultureRows(none)).toEqual([]);
    expect(none.culture).toEqual({ from: "2026-10-02", day: utcDay(Date.now()), region: null });
    expect(none).not.toHaveProperty("region");
    expect(read).toHaveBeenCalledTimes(1);

    const off = (await call(h, { culture: false, region: "JP" })).body;
    expect(cultureRows(off)).toEqual([]);
    expect([off.culture, off.region]).toEqual([null, "JP"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("takes the region of the locale tag when the body names none", async () => {
    const { h } = setup();
    const { body } = await call(h, { locale: "en-JP" });
    expect(cultureRows(body).map((r) => r.cultureId)).toEqual(["ship-bow-jp"]);
    expect(body.culture?.region).toBe("JP");
    expect(body).not.toHaveProperty("region");
  });

  it("with region auto, uses the request's country", async () => {
    const { h } = setup();
    const jp = (await call(h, { region: "auto" }, (r) => fromCountry(r, "JP"))).body;
    expect([jp.region, cultureRows(jp).map((r) => r.emoji)]).toEqual(["JP", ["🌋"]]);
    const us = (await call(h, { region: "auto" }, (r) => fromCountry(r, "US"))).body;
    expect([us.region, cultureRows(us)]).toEqual(["US", []]);
    const unknown = (await call(h, { region: "auto" })).body;
    expect([unknown.region, cultureRows(unknown)]).toEqual([null, []]);
  });

  it("checks windows against the body's day, else the caller's local day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T23:30:00Z"));
    const { h } = setup();
    const puppy = async (input: object, edit?: (r: Request) => Request) => {
      const { body } = await call(h, { text: "look at this puppy", region: "JP", ...input }, edit);
      return [body.culture?.day, cultureRows(body).map((r) => r.cultureId)];
    };
    expect(await puppy({})).toEqual(["2026-09-30", []]);
    expect(await puppy({}, (r) => fromEdge(r, { timezone: "Asia/Tokyo" }))).toEqual([
      "2026-10-01",
      ["lava-week-jp"],
    ]);
    expect(await puppy({ day: "2026-10-08" }, (r) => fromEdge(r, { timezone: "Asia/Tokyo" }))).toEqual([
      "2026-10-08",
      [],
    ]);
  });

  it("rejects a bad culture, region or day", async () => {
    const { h } = setup();
    for (const input of [
      { culture: "yes" },
      { culture: 1 },
      { region: "JPN" },
      { region: 81 },
      { day: "2026-02-30" },
      { day: "tomorrow" },
    ]) {
      const { res } = await call(h, input);
      expect([input, res.status]).toEqual([input, 400]);
    }
    expect(h.ai).not.toHaveBeenCalled();
  });
});

describe("truncateText", () => {
  it("collapses whitespace and counts code points", () => {
    expect(truncateText("  a \n\t b  ", 10)).toBe("a b");
    expect(truncateText("🎉🎉🎉", 2)).toBe("🎉🎉");
  });
});
