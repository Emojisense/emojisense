import { type CustomEmojiRow, dayOf } from "@emojisense/platform";
import { createEngine, type Pack } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { buildCustomPack, customPackRow } from "../src/custom-pack.ts";
import type { CustomEmojiReader } from "../src/custom-store.ts";
import type { SearchBody } from "../src/search.ts";
import { APP, customEmojiDatabase, memoryBucket, PNG } from "./custom-fixtures.ts";
import { API, harness, KEYS, reactions, search, seededStore } from "./fixtures.ts";

async function setup(options: { reader?: CustomEmojiReader; now?: () => number } = {}) {
  const { db, reader } = customEmojiDatabase();
  const bucket = memoryBucket({ [`custom/${APP}/_/e_parrot.png`]: PNG });
  const custom = options.reader ?? reader;
  const store = await seededStore();
  const h = harness({
    store,
    customEmoji: custom,
    env: { EMOJI: bucket },
    ...(options.now ? { now: options.now } : {}),
  });
  return { h, db, bucket, store, reader: custom };
}

const imageRequest = (path: string, init?: RequestInit) => new Request(`${API}${path}`, init);
const pack = (query = "") => new Request(`${API}/v1/custom-pack?key=${KEYS.pro}${query}`);

describe("GET /v1/custom/:appId/:emojiId", () => {
  it("serves the image from R2 with immutable, cross-origin and sandbox headers", async () => {
    const { h } = await setup();
    const res = await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
      etag: `"etag-custom/${APP}/_/e_parrot.png"`,
    });
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("needs no key and answers repeats from the edge cache", async () => {
    const { h, bucket } = await setup();
    h.env.ANON_LIMITER = { limit: async () => ({ success: false }) };
    await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`));
    await h.ctx.settle();
    const again = await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`));
    expect(again.status).toBe(200);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG);
    expect(bucket.gets).toHaveLength(1);
  });

  it("keeps the edge copy one day while browsers keep the image immutable", async () => {
    const { h } = await setup();
    await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`));
    await h.ctx.settle();
    const url = `${API}/v1/custom/${APP}/e_parrot`;
    expect(h.cache.puts).toEqual([url]);
    expect(h.cache.store.get(url)?.headers.get("cache-control")).toBe("public, max-age=86400");
    const again = await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`));
    expect(again.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(again.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("answers 404 for unknown emoji, another app's emoji and missing objects", async () => {
    const { h } = await setup();
    expect((await h.call(imageRequest(`/v1/custom/${APP}/nope`))).status).toBe(404);
    expect((await h.call(imageRequest("/v1/custom/app_free/e_parrot"))).status).toBe(404);
    // e_ship has a row but no object in the bucket.
    const missing = await h.call(imageRequest(`/v1/custom/${APP}/e_ship`));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect((await h.call(imageRequest("/v1/custom/a/b/c"))).status).toBe(404);
  });

  it("allows only GET", async () => {
    const { h } = await setup();
    const res = await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`, { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("answers 503 when the database fails, without caching it", async () => {
    const reader: CustomEmojiReader = {
      listUsable: async () => [],
      find: async () => Promise.reject(new Error("D1 down")),
    };
    const { h } = await setup({ reader });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await h.call(imageRequest(`/v1/custom/${APP}/e_parrot`));
    expect(res.status).toBe(503);
    expect(h.cache.store.size).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(APP);
    warn.mockRestore();
  });
});

describe("GET /v1/custom-pack", () => {
  it("returns the app-wide custom emoji as a custom pack", async () => {
    const { h } = await setup();
    const res = await h.call(pack());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = (await res.json()) as Pack;
    expect(body).toMatchObject({
      format: "emojisense-pack",
      formatVersion: 1,
      part: "custom",
      locale: "und",
    });
    expect(body.emoji).toEqual([
      [
        ":party_parrot:",
        "C-e_parrot",
        0,
        0,
        0,
        "party_parrot",
        "party parrot",
        "",
        "celebrate|dance",
        "",
        "",
      ],
      [":shipit:", "C-e_ship", 0, 0, 0, "shipit", "shipit", "", "ship it", "", ""],
    ]);
    expect(body.images).toEqual({
      "C-e_parrot": `${API}/v1/custom/${APP}/e_parrot`,
      "C-e_ship": `${API}/v1/custom/${APP}/e_ship`,
    });
  });

  it("adds the tenant's emoji, which replace app-wide ones with the same shortcode", async () => {
    const { h } = await setup();
    const body = (await (await h.call(pack("&tenant=acme"))).json()) as Pack;
    expect(body.emoji.map((row) => row[1])).toEqual(["C-e_parrot", "C-e_acme"]);
  });

  it("points images at API_URL when it is set", async () => {
    const { h } = await setup();
    h.env.API_URL = "https://api.emojisense.example";
    const body = (await (await h.call(pack())).json()) as Pack;
    expect(body.images?.["C-e_parrot"]).toBe(`https://api.emojisense.example/v1/custom/${APP}/e_parrot`);
    const found = (await (await h.call(search("party", `&key=${KEYS.pro}`))).json()) as SearchBody;
    expect(found.results[0]?.imageUrl).toBe(`https://api.emojisense.example/v1/custom/${APP}/e_parrot`);
  });

  it("is cached at the edge per app and tenant", async () => {
    const { h, reader } = await setup();
    const listUsable = vi.spyOn(reader, "listUsable");
    await h.call(pack());
    await h.ctx.settle();
    await h.call(pack());
    await h.call(pack("&tenant=acme"));
    await h.ctx.settle();
    expect(listUsable.mock.calls).toEqual([
      [APP, undefined],
      [APP, "acme"],
    ]);
    expect(h.cache.puts.every((url) => !url.includes(KEYS.pro))).toBe(true);
  });

  it("needs a key; a development key gets an empty pack", async () => {
    const { h } = await setup();
    expect((await h.call(new Request(`${API}/v1/custom-pack`))).status).toBe(401);
    const dev = harness({ customEmoji: customEmojiDatabase().reader, env: { DEV_KEYS: "pk_devonly" } });
    const res = await dev.call(new Request(`${API}/v1/custom-pack?key=pk_devonly`));
    expect(((await res.json()) as Pack).emoji).toEqual([]);
  });

  it("rejects an overlong tenant", async () => {
    const { h } = await setup();
    expect((await h.call(pack(`&tenant=${"x".repeat(129)}`))).status).toBe(400);
  });

  it("answers an uncached empty pack when the database fails", async () => {
    const reader: CustomEmojiReader = {
      listUsable: async () => Promise.reject(new Error("D1 down")),
      find: async () => undefined,
    };
    const { h } = await setup({ reader });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await h.call(pack());
    await h.ctx.settle();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as Pack).emoji).toEqual([]);
    expect(h.cache.store.size).toBe(0);
    warn.mockRestore();
  });
});

describe("custom emoji in /v1/search", () => {
  const keyed = (q: string, extra = "") => search(q, `&key=${KEYS.pro}${extra}`);

  it("merges custom matches first, with source custom, imageUrl and shortcode", async () => {
    const { h } = await setup();
    const res = await h.call(keyed("party"));
    const body = (await res.json()) as SearchBody;
    expect(body.results[0]).toEqual({
      emoji: ":party_parrot:",
      id: "C-e_parrot",
      score: expect.any(Number),
      source: "custom",
      imageUrl: `${API}/v1/custom/${APP}/e_parrot`,
      shortcode: "party_parrot",
    });
    expect(body.results.slice(1).every((r) => r.source !== "custom")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("keeps custom results out of the shared edge cache, and merges them into hits", async () => {
    const { h } = await setup();
    await h.call(keyed("ship it"));
    await h.ctx.settle();
    for (const stored of h.cache.store.values()) {
      expect(JSON.stringify(await stored.clone().json())).not.toContain("custom");
    }
    const hit = (await (await h.call(keyed("ship it"))).json()) as SearchBody;
    expect(hit.cached).toBe(true);
    expect(hit.results[0]).toMatchObject({ id: "C-e_ship", source: "custom" });
    const anonymous = (await (await h.call(search("ship it"))).json()) as SearchBody;
    expect(anonymous.results.some((r) => r.source === "custom")).toBe(false);
  });

  it("uses the tenant's emoji with tenant=", async () => {
    const { h } = await setup();
    const body = (await (await h.call(keyed("shipit", "&tenant=acme"))).json()) as SearchBody;
    expect(body.results[0]).toMatchObject({ id: "C-e_acme", imageUrl: `${API}/v1/custom/${APP}/e_acme` });
    expect(body.results.some((r) => r.id === "C-e_ship")).toBe(false);
  });

  it("keeps the limit", async () => {
    const { h } = await setup();
    const body = (await (await h.call(keyed("ship it", "&limit=1"))).json()) as SearchBody;
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.source).toBe("custom");
  });

  it("reads the database once per isolate and minute", async () => {
    let now = Date.UTC(2026, 9, 2, 12);
    const { h, reader } = await setup({ now: () => now });
    const listUsable = vi.spyOn(reader, "listUsable");
    await h.call(keyed("party"));
    await h.call(keyed("dance"));
    expect(listUsable).toHaveBeenCalledTimes(1);
    now += 61_000;
    await h.call(keyed("party"));
    expect(listUsable).toHaveBeenCalledTimes(2);
  });

  it("counts a search that only custom emoji answer as found, not as a miss", async () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const { h, store } = await setup({ now: () => now });
    h.env.AI = { run: async () => Promise.reject(new Error("offline")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (await h.call(keyed("celebrate"))).json()) as SearchBody;
    expect(body.results.map((r) => r.source)).toEqual(["custom"]);
    await h.ctx.settle();
    await h.app.queryStats?.flush();
    expect(store.queryCountOf(APP, dayOf(now), "celebrate")).toMatchObject({ searches: 1, misses: 0 });
    warn.mockRestore();
  });

  it("searches on without custom emoji when the database fails", async () => {
    const reader: CustomEmojiReader = {
      listUsable: async () => Promise.reject(new Error("D1 down")),
      find: async () => undefined,
    };
    const { h } = await setup({ reader });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await h.call(keyed("rocket"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as SearchBody).results[0]?.emoji).toBe("🚀");
    warn.mockRestore();
  });

  it("rejects an overlong tenant", async () => {
    const { h } = await setup();
    expect((await h.call(keyed("party", `&tenant=${"x".repeat(129)}`))).status).toBe(400);
  });
});

describe("custom emoji in /v1/suggest-reactions", () => {
  it("merges the caller's custom matches first, tenant from the body", async () => {
    const { h } = await setup();
    const res = await h.call(reactions({ text: "time to celebrate", tenant: "acme" }, `?key=${KEYS.pro}`));
    const body = (await res.json()) as SearchBody;
    expect(body.results[0]).toMatchObject({ id: "C-e_parrot", source: "custom" });
  });

  it("takes the tenant from the query too", async () => {
    const { h } = await setup();
    const body = (await (
      await h.call(reactions({ text: "acme ship" }, `?key=${KEYS.pro}&tenant=acme`))
    ).json()) as SearchBody;
    expect(body.results[0]).toMatchObject({ id: "C-e_acme" });
  });
});

describe("buildCustomPack", () => {
  const row = (overrides: Partial<CustomEmojiRow> = {}): CustomEmojiRow => ({
    id: "e1",
    app_id: "app",
    tenant_id: "",
    shortcode: "thumbs-up_2",
    aliases: '["Looks Good", "looks good", "LGTM|x"]',
    image_key: "k",
    content_type: "image/png",
    bytes: 1,
    source: "upload",
    created_at: 0,
    ...overrides,
  });

  it("normalizes the shortcode words and the aliases into pack phrases", () => {
    expect(customPackRow(row())).toEqual([
      ":thumbs-up_2:",
      "C-e1",
      0,
      0,
      0,
      "thumbs-up_2",
      "thumbs up 2",
      "",
      "looks good|lgtm x",
      "",
      "",
    ]);
  });

  it("versions the pack by its content", () => {
    const a = buildCustomPack([row()], API);
    expect(a.packVersion).toMatch(/^custom-[0-9a-f]{8}$/);
    expect(buildCustomPack([row()], API).packVersion).toBe(a.packVersion);
    expect(buildCustomPack([row({ shortcode: "other" })], API).packVersion).not.toBe(a.packVersion);
  });

  it("loads into the core engine next to a catalog pack", () => {
    const catalogPack: Pack = {
      format: "emojisense-pack",
      formatVersion: 1,
      packVersion: "test",
      locale: "en",
      emojiVersion: "17.0",
      groups: ["g"],
      emoji: [["👍", "1F44D", 0, 1, 1, "thumbs up", "thumbsup", "", "lgtm", "", ""]],
    };
    const engine = createEngine([catalogPack, buildCustomPack([row()], API)]);
    expect(engine.search("looks good").results[0]).toMatchObject({
      id: "C-e1",
      source: "custom",
      imageUrl: `${API}/v1/custom/app/e1`,
    });
  });
});
