import type { DatabaseSync } from "node:sqlite";
import type { Shard, ShardIndex } from "@emojisense/data/shards";
import { addDays, dayOf } from "@emojisense/platform";
import { createLayeredSemantic, createSemanticClient, createShardProvider } from "emojisense";
import { decodeVectors, encodeVectors } from "emojisense/vectors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiBinding, Env } from "../src/env.ts";
import { runScheduled } from "../src/scheduled.ts";
import type { Catalog } from "../src/semantic.ts";
import { runShardBuild, type ShardLimits } from "../src/shards/job.ts";
import { selectCandidates, selectionWindow } from "../src/shards/select.ts";
import { type ShardPointer, storePrefix } from "../src/shards/storage.ts";
import { API, catalog, EMBEDDING_MODEL, fixtureVectors, harness, ROW, TEST_KEY, unit } from "./fixtures.ts";
import { memoryR2 } from "./memory-r2.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

/** The cron's scheduled time: 2026-10-15 04:23 UTC. */
const NOW = Date.UTC(2026, 9, 15, 4, 23);
const daysAgo = (n: number) => addDays(dayOf(NOW), -n);
const PREFIX = storePrefix("test", "c0ffee");
const DAY = 24 * 3600 * 1000;

/** Embeds by topic, a whole batch per call, like Workers AI. */
const TOPICS: [RegExp, number][] = [
  [/lava|erupt|magma/, ROW.volcano],
  [/extinct|reptile|fossil/, ROW.trex],
  [/launch|liftoff|orbit/, ROW.rocket],
];
function batchAi(options: { fail?: boolean } = {}) {
  return vi.fn<AiBinding["run"]>(async (_model, input) => {
    if (options.fail) throw new TypeError("network");
    const texts = (input as { text: string[] }).text;
    return {
      data: texts.map((t) => Array.from(unit(TOPICS.find(([topic]) => topic.test(t))?.[1] ?? ROW.dog))),
    };
  });
}

/** Accounts a–e with one app each; account a has two more apps. */
function seededDatabase(): DatabaseSync {
  const db = migratedDatabase();
  for (const id of ["a", "b", "c", "d", "e"]) {
    db.exec(`
      INSERT INTO accounts (id, created_at, plan) VALUES ('acc_${id}', 0, 'pro');
      INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_${id}', 'acc_${id}', 'App', 'pro', 0);`);
  }
  db.exec(`
    INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_a2', 'acc_a', 'App 2', 'pro', 0);
    INSERT INTO apps (id, account_id, name, plan, created_at) VALUES ('app_a3', 'acc_a', 'App 3', 'pro', 0);`);
  return db;
}

/** Rows without a locale are rows from before migration 0004: they count as English. */
function searched(
  db: DatabaseSync,
  query: string,
  rows: [app: string, searches: number, daysAgo?: number][],
  locale?: string,
) {
  for (const [app, searches, ago = 1] of rows) {
    db.prepare(
      `INSERT INTO query_daily (app_id, day, query, locale, searches, misses)
       VALUES (?, ?, ?, COALESCE(?, 'und'), ?, 0)`,
    ).run(`app_${app}`, daysAgo(ago), query, locale ?? null, searches);
  }
}

/** Seen by three accounts, 12 times. */
const popular = (db: DatabaseSync, query: string, extra = 0, locale?: string) =>
  searched(
    db,
    query,
    [
      ["a", 4 + extra],
      ["b", 4],
      ["c", 4, 3],
    ],
    locale,
  );

/**
 * The fixture catalog with a Turkish alias engine and Turkish vectors: in Turkish, the lava text
 * lands on 🐶's row, so a Turkish answer differs from the English one.
 */
const turkishIndex = decodeVectors(encodeVectors(EMBEDDING_MODEL, ["1F436"], [unit(ROW.volcano)]));
const withTurkish: Catalog = {
  ...catalog,
  aliasEngine: async (locale, env) => (locale === "tr" ? catalog.engine() : catalog.aliasEngine(locale, env)),
  vectors: async (locale) => ({
    indexes: locale === "tr" ? [fixtureVectors(), turkishIndex] : [fixtureVectors()],
    complete: true,
  }),
};

const RULES = { minAccounts: 3, minSearches: 10, maxQueries: 100 };

describe("selectCandidates", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = seededDatabase();
  });

  it("reads the last 6 complete UTC days, never today", () => {
    expect(selectionWindow(NOW, 6)).toEqual({ from: daysAgo(6), to: daysAgo(1) });
  });

  it("selects a query only when apps of 3 accounts searched it 10 times in the window", async () => {
    popular(db, "lava eruption");
    searched(db, "extinct reptiles", [
      ["a", 50],
      ["b", 50],
    ]);
    searched(db, "launch day", [
      ["a", 3],
      ["b", 3],
      ["c", 3],
    ]);
    // Three apps of one account are one account.
    searched(db, "one customer", [
      ["a", 10],
      ["a2", 10],
      ["a3", 10],
    ]);
    // Seven days ago and today are outside the window.
    searched(db, "too old", [
      ["a", 9, 7],
      ["b", 9, 7],
      ["c", 9, 7],
    ]);
    searched(db, "too new", [
      ["a", 9, 0],
      ["b", 9, 0],
      ["c", 9, 0],
    ]);
    // The edges of the window count: 6 days ago and yesterday.
    searched(db, "edges", [
      ["a", 5, 6],
      ["b", 5, 1],
      ["d", 5, 6],
    ]);

    const selection = await selectCandidates(sqliteD1(db), selectionWindow(NOW, 6), RULES);
    expect(selection).toEqual({
      candidates: [
        { q: "edges", locale: "en", searches: 15 },
        { q: "lava eruption", locale: "en", searches: 12 },
      ],
      privacyDropped: 0,
    });
  });

  it("orders by searches, then text, and keeps at most maxQueries", async () => {
    popular(db, "b query", 5);
    popular(db, "a query");
    popular(db, "c query");
    const { candidates } = await selectCandidates(sqliteD1(db), selectionWindow(NOW, 6), {
      ...RULES,
      maxQueries: 2,
    });
    expect(candidates.map((c) => c.q)).toEqual(["b query", "a query"]);
  });

  it("drops personal-looking text and text the SDK cannot look up, however popular", async () => {
    popular(db, "jane doe gmail com", 100);
    popular(db, "555 010 0199", 100);
    popular(db, "Lava!", 100);
    popular(db, "lava eruption");
    const selection = await selectCandidates(sqliteD1(db), selectionWindow(NOW, 6), RULES);
    expect(selection).toEqual({
      candidates: [{ q: "lava eruption", locale: "en", searches: 12 }],
      privacyDropped: 3,
    });
  });

  it("holds the thresholds per locale: each shard file shows its query was searched there", async () => {
    // Three accounts in all, but only two in English and one in Portuguese.
    searched(
      db,
      "football",
      [
        ["a", 10],
        ["b", 10],
      ],
      "en",
    );
    searched(db, "football", [["c", 10]], "pt");
    popular(db, "futebol", 0, "pt");
    popular(db, "lava eruption", 0, "tr");
    popular(db, "lava eruption", 5, "en");
    const { candidates } = await selectCandidates(sqliteD1(db), selectionWindow(NOW, 6), RULES);
    expect(candidates).toEqual([
      { q: "lava eruption", locale: "en", searches: 17 },
      { q: "futebol", locale: "pt", searches: 12 },
      { q: "lava eruption", locale: "tr", searches: 12 },
    ]);
  });
});

describe("nightly shard build", () => {
  let db: DatabaseSync;
  let r2: ReturnType<typeof memoryR2>;
  let ai: ReturnType<typeof batchAi>;
  let clock: number;
  const env = (overrides: Partial<Env> = {}): Env => ({
    DB: sqliteD1(db) as unknown as D1Database,
    SHARDS: r2.r2,
    AI: { run: ai },
    SHARDS_CRON_ENABLED: "true",
    ...overrides,
  });
  const run = (limits: Partial<ShardLimits> = {}, overrides: Partial<Env> = {}, now = NOW, from = catalog) =>
    runShardBuild(env(overrides), from, { now, limits: { results: 4, ...limits } });
  const pointer = () => r2.json<ShardPointer>(`${PREFIX}current.json`);

  beforeEach(() => {
    db = seededDatabase();
    clock = NOW;
    r2 = memoryR2(() => clock);
    ai = batchAi();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("publishes the API's semantic answers for the selected queries", async () => {
    popular(db, "lava eruption");
    popular(db, "extinct reptiles");
    popular(db, "rocket"); // The device answers it: no shard entry.

    const report = await run();

    expect(report).toMatchObject({
      status: "published",
      candidates: 3,
      answeredOnDevice: 1,
      embedded: 2,
      queries: 2,
      reused: 0,
      deferred: 0,
    });
    const { build } = pointer();
    expect(pointer()).toMatchObject({
      format: "emojisense-shard-pointer",
      previous: null,
      model: "bge-m3@8",
      results: 4,
      queries: 2,
      window: { from: daysAgo(6), to: daysAgo(1) },
      checkedDay: dayOf(NOW),
    });
    const index = r2.json<ShardIndex>(`${PREFIX}${build}/index.json`);
    expect(index).toMatchObject({ format: "emojisense-shards", packVersion: "test", model: "bge-m3@8" });
    const entries = Object.assign(
      {},
      ...index.keys.map((key) => r2.json<Shard>(`${PREFIX}${build}/${encodeURIComponent(key)}.json`).entries),
    );
    expect(Object.keys(entries).sort()).toEqual(["extinct reptiles", "lava eruption"]);
    expect(entries["lava eruption"][0]).toEqual(["🌋", "1F30B", 1]);
    // One Workers AI call for both queries, with the text the API embeds.
    expect(ai).toHaveBeenCalledTimes(1);
    expect(ai).toHaveBeenCalledWith("@cf/baai/bge-m3", { text: ["extinct reptiles", "lava eruption"] });
  });

  it("logs counts only, never query text", async () => {
    popular(db, "lava eruption");
    await run();
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(logged.some((line) => line.includes('"event":"shards_built"'))).toBe(true);
    expect(logged.join("\n")).not.toContain("lava");
  });

  it("embeds in batches of the model's maximum", async () => {
    for (const q of ["lava one", "lava two", "lava three", "lava four", "lava five"]) popular(db, q);
    const small: Catalog = { ...catalog, model: { ...catalog.model, maxBatch: 2 } };
    await run({}, {}, NOW, small);
    expect(ai).toHaveBeenCalledTimes(3);
  });

  it("stops at the embedding budget and embeds the rest on the next nights", async () => {
    for (const [i, q] of ["lava one", "lava two", "lava three", "lava four", "lava five"].entries()) {
      popular(db, q, 5 - i);
    }

    const first = await run({ maxEmbeddings: 2 });
    expect(first).toMatchObject({ status: "published", embedded: 2, deferred: 3, queries: 2 });
    expect(Object.keys(await served())).toEqual(["lava one", "lava two"]);

    const second = await run({ maxEmbeddings: 2 });
    expect(second).toMatchObject({ status: "published", reused: 2, embedded: 2, deferred: 1, queries: 4 });
    const third = await run({ maxEmbeddings: 2 });
    expect(third).toMatchObject({ reused: 4, embedded: 1, deferred: 0, queries: 5 });
    // 2 + 2 + 1 texts embedded in total: reused entries are never embedded again.
    const embedded = ai.mock.calls.flatMap(([, input]) => (input as { text: string[] }).text);
    expect(embedded).toHaveLength(5);
    expect(new Set(embedded).size).toBe(5);
  });

  async function served(): Promise<Record<string, unknown>> {
    const { build } = pointer();
    const index = r2.json<ShardIndex>(`${PREFIX}${build}/index.json`);
    return Object.assign(
      {},
      ...index.keys.map((key) => r2.json<Shard>(`${PREFIX}${build}/${encodeURIComponent(key)}.json`).entries),
    );
  }

  it("is idempotent: a second run on the same day publishes the same build and embeds nothing", async () => {
    popular(db, "lava eruption");
    popular(db, "extinct reptiles");
    const first = await run();
    const objects = new Map([...r2.objects].map(([key, o]) => [key, o.text]));
    const puts = r2.calls.put;

    const again = await run();

    expect(again).toMatchObject({
      status: "unchanged",
      build: first.build,
      reused: 2,
      embedded: 0,
      bytes: 0,
    });
    expect(ai).toHaveBeenCalledTimes(1);
    // Only the pointer is written again, with the same content.
    expect(r2.calls.put).toBe(puts + 1);
    expect(new Map([...r2.objects].map(([key, o]) => [key, o.text]))).toEqual(objects);
  });

  it("keeps the current and the previous build and deletes older ones", async () => {
    popular(db, "lava one");
    const a = await run();
    popular(db, "lava two");
    const b = await run();
    popular(db, "lava three");
    const c = await run();

    expect(new Set([a.build, b.build, c.build]).size).toBe(3);
    expect(pointer()).toMatchObject({ build: c.build, previous: b.build });
    const builds = new Set(r2.keys(PREFIX).map((k) => k.slice(PREFIX.length).split("/")[0]));
    expect(builds).toEqual(new Set(["current.json", b.build, c.build]));
    expect(c.pruned).toBeGreaterThan(0);
  });

  it("deletes the stores of gone deployments after a week, and keeps live ones", async () => {
    const put = (key: string, at: number) => {
      clock = at;
      return r2.bucket.put(key, "{}");
    };
    await put("shards/test/0ld/current.json", NOW - 8 * DAY);
    await put("shards/test/0ld/abc/index.json", NOW - 9 * DAY);
    await put("shards/0.0.9/f00/abc/index.json", NOW - 30 * DAY);
    await put("shards/test/l1ve/current.json", NOW - 2 * DAY);
    await put("shards/test/l1ve/abc/index.json", NOW - 20 * DAY);
    clock = NOW;
    popular(db, "lava eruption");

    const report = await run();

    expect(report.pruned).toBe(3);
    expect(r2.keys("shards/test/0ld/")).toEqual([]);
    expect(r2.keys("shards/0.0.9/")).toEqual([]);
    expect(r2.keys("shards/test/l1ve/")).toHaveLength(2);
  });

  it("keeps serving the current build when Workers AI fails", async () => {
    popular(db, "lava eruption");
    const first = await run();
    popular(db, "extinct reptiles");
    ai = batchAi({ fail: true });

    await expect(run()).rejects.toThrow("every Workers AI call failed");
    expect(pointer().build).toBe(first.build);
  });

  it("removes a query from the public files once it no longer passes the thresholds", async () => {
    popular(db, "lava eruption");
    await run();
    // A week later the searches are out of the window: an empty build replaces the old one.
    const later = await run({}, {}, NOW + 7 * DAY);
    expect(later).toMatchObject({ status: "published", queries: 0, shards: 0 });
    const index = r2.json<ShardIndex>(`${PREFIX}${pointer().build}/index.json`);
    expect(index.keys).toEqual([]);
  });

  it("publishes nothing when no query passes the thresholds", async () => {
    searched(db, "lava eruption", [["a", 100]]);
    expect(await run()).toMatchObject({ status: "empty", candidates: 0 });
    expect(r2.objects.size).toBe(0);
  });

  it("skips when switched off or a binding is missing", async () => {
    popular(db, "lava eruption");
    expect(await run({}, { SHARDS_CRON_ENABLED: "false" })).toMatchObject({
      status: "skipped",
      reason: "disabled",
    });
    expect(await run({}, { AI: undefined })).toMatchObject({ status: "skipped", reason: "no Workers AI" });
    expect(await run({}, { SHARDS: undefined })).toMatchObject({ status: "skipped", reason: "no bucket" });
    expect(r2.objects.size).toBe(0);
    expect(ai).not.toHaveBeenCalled();
  });

  it("builds a directory per locale with that locale's answers, English at the build root", async () => {
    popular(db, "lava eruption", 0, "en");
    popular(db, "lava eruption", 0, "tr");
    popular(db, "extinct reptiles", 0, "tr");

    const report = await run({}, {}, NOW, withTurkish);

    expect(report).toMatchObject({
      status: "published",
      queries: 3,
      locales: { en: { queries: 1, shards: 1 }, tr: { queries: 2, shards: 2 } },
    });
    expect(pointer().locales).toEqual(report.locales);
    const { build } = pointer();
    const en = r2.json<ShardIndex>(`${PREFIX}${build}/index.json`);
    const tr = r2.json<ShardIndex>(`${PREFIX}${build}/tr/index.json`);
    const entries = (index: ShardIndex, dir: string) =>
      Object.assign(
        {},
        ...index.keys.map(
          (key) => r2.json<Shard>(`${PREFIX}${build}/${dir}${encodeURIComponent(key)}.json`).entries,
        ),
      );
    expect(Object.keys(entries(en, ""))).toEqual(["lava eruption"]);
    expect(Object.keys(entries(tr, "tr/")).sort()).toEqual(["extinct reptiles", "lava eruption"]);
    expect(entries(en, "")["lava eruption"][0][0]).toBe("🌋");
    // The Turkish vectors put 🐶 level with 🌋 for this text.
    expect(
      entries(tr, "tr/")
        ["lava eruption"].slice(0, 2)
        .map((r: [string]) => r[0])
        .sort(),
    ).toEqual(["🌋", "🐶"]);
    // One text, embedded once per locale that needs it.
    expect(ai.mock.calls.flatMap(([, input]) => (input as { text: string[] }).text).sort()).toEqual([
      "extinct reptiles",
      "lava eruption",
      "lava eruption",
    ]);
  });

  it("spends one embedding budget on the most searched new queries of every locale", async () => {
    popular(db, "lava eruption", 0, "en");
    popular(db, "lava one", 9, "tr");
    popular(db, "lava two", 5, "tr");

    const first = await run({ maxEmbeddings: 2 }, {}, NOW, withTurkish);
    expect(first).toMatchObject({
      embedded: 2,
      deferred: 1,
      locales: { en: { queries: 0 }, tr: { queries: 2 } },
    });
    const second = await run({ maxEmbeddings: 2 }, {}, NOW, withTurkish);
    expect(second).toMatchObject({ reused: 2, embedded: 1, deferred: 0, queries: 3 });
  });

  it("leaves out a locale whose alias engine does not load, and keeps the others", async () => {
    popular(db, "lava eruption", 0, "en");
    popular(db, "lava eruption", 0, "de");
    const report = await run();
    expect(report).toMatchObject({
      status: "published",
      skippedLocales: ["de"],
      locales: { en: { queries: 1 } },
    });
    expect(r2.keys(`${PREFIX}${pointer().build}/de/`)).toEqual([]);
  });

  it("runs on its own cron; the other cron runs the retention jobs", async () => {
    popular(db, "lava eruption");
    await runScheduled({ cron: "17 3 * * *", scheduledTime: NOW }, env(), catalog);
    expect(r2.objects.size).toBe(0);
    await runScheduled({ cron: "23 4 * * *", scheduledTime: NOW }, env(), catalog);
    expect(pointer().queries).toBe(1);
  });

  describe("concepts of popular unsure queries", () => {
    /** "kendrick lamar" embeds next to no fixture row (unsure); the model reads it as a person. */
    const withConcepts = () =>
      vi.fn<AiBinding["run"]>(async (model, input) => {
        if ("messages" in input) {
          const content = JSON.stringify({ kind: "person", concepts: ["puppy"], emoji: ["🚀", "🐶"] });
          return { choices: [{ message: { content } }] };
        }
        const texts = (input as { text: string[] }).text;
        return { data: texts.map((t) => Array.from(unit(/kendrick/.test(t) ? 4 : ROW.volcano))) };
      });
    const conceptCalls = () => ai.mock.calls.filter(([, input]) => "messages" in input);
    const rows = () => db.prepare("SELECT status FROM concept_cache").all() as { status: string }[];

    it("stores their concept answer and leads their shard entry with it", async () => {
      ai = withConcepts();
      popular(db, "kendrick lamar");
      popular(db, "lava eruption");
      const report = await run();
      expect(report.concepts).toMatchObject({ checked: 2, unsure: 1, asked: 1, merged: 1 });
      expect(rows()).toEqual([{ status: "ok" }]);
      const published = (await served()) as Record<string, [string, string, number][]>;
      expect(published["kendrick lamar"]?.slice(0, 2).map(([emoji]) => emoji)).toEqual(["🐶", "🚀"]);
      expect(published["lava eruption"]?.[0]?.[0]).toBe("🌋");
    });

    it("asks the model once: the next run reuses the entry and publishes the same build", async () => {
      ai = withConcepts();
      popular(db, "kendrick lamar");
      const first = await run();
      const again = await run();
      expect(again).toMatchObject({ status: "unchanged", build: first.build });
      expect(conceptCalls()).toHaveLength(1);
    });

    it("stops at its model-call budget and leaves the rest to the API", async () => {
      ai = withConcepts();
      popular(db, "kendrick lamar");
      const report = await run({ maxConceptCalls: 0 });
      expect(report.concepts).toMatchObject({ unsure: 1, asked: 0, skipped: 1, merged: 0 });
      expect(conceptCalls()).toHaveLength(0);
      expect(rows()).toEqual([]);
    });

    it("leaves the shards alone with the tier switched off", async () => {
      ai = withConcepts();
      popular(db, "kendrick lamar");
      const report = await run({}, { CONCEPTS_ENABLED: "false" });
      expect(report.concepts).toMatchObject({ checked: 0, merged: 0 });
      expect(conceptCalls()).toHaveLength(0);
    });
  });
});

describe("GET /p/*", () => {
  let db: DatabaseSync;
  let r2: ReturnType<typeof memoryR2>;
  let clock: number;
  const assets = vi.fn(async (url: string) =>
    url.endsWith("/p/test/index.json")
      ? new Response(JSON.stringify({ static: true }), { headers: { "Cache-Control": "immutable" } })
      : new Response("", { status: 404 }),
  );

  const setup = () => {
    const h = harness({
      now: () => clock,
      env: {
        DB: sqliteD1(db) as unknown as D1Database,
        SHARDS: r2.r2,
        AI: { run: batchAi() },
        ASSETS: { fetch: assets },
        SHARDS_CRON_ENABLED: "true",
      },
    });
    const build = (limits: Partial<ShardLimits> = {}) =>
      runShardBuild(h.env, catalog, { now: clock, limits: { results: 4, ...limits } });
    const get = (path: string, init?: RequestInit) => h.call(new Request(`${API}${path}`, init));
    return { h, build, get };
  };

  beforeEach(() => {
    db = seededDatabase();
    clock = NOW;
    r2 = memoryR2(() => clock);
    assets.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    popular(db, "lava eruption");
    popular(db, "the end of the world");
  });

  it("serves the nightly build with an hourly index, CORS and an edge copy", async () => {
    const { h, build, get } = setup();
    await build();

    const res = await get("/p/test/index.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const index = (await res.json()) as ShardIndex;
    expect(index.model).toBe("bge-m3@8");

    const key = index.keys.find((k) => k.startsWith("t")) as string;
    const shard = await get(`/p/test/${encodeURIComponent(key)}.json`);
    expect(shard.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(Object.keys(((await shard.json()) as Shard).entries)).toEqual(["the end of the world"]);

    await h.ctx.settle();
    const reads = r2.calls.get;
    expect((await get("/p/test/index.json")).status).toBe(200);
    expect(r2.calls.get).toBe(reads);
  });

  it("finds a key file however its name is encoded, and answers 404 for unknown keys", async () => {
    popular(db, "+1 for this");
    popular(db, "дом и сад");
    const { build, get } = setup();
    // A budget below one entry: every query gets its own key, spaces and all.
    await build({ maxShardBytes: 50 });
    const index = (await (await get("/p/test/index.json")).json()) as ShardIndex;
    expect(index.keys).toEqual(expect.arrayContaining(["+1 for this", "дом и сад"]));
    for (const key of index.keys) {
      expect([key, (await get(`/p/test/${encodeURIComponent(key)}.json`)).status]).toEqual([key, 200]);
    }
    expect((await get("/p/test/+1%20for%20this.json")).status).toBe(200);
    const lowerHex = encodeURIComponent("дом и сад").toLowerCase();
    expect((await get(`/p/test/${lowerHex}.json`)).status).toBe(200);

    const missing = await get("/p/test/zzz.json");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("public, max-age=300");
    expect((await get("/p/test/%E0%A4%A.json")).status).toBe(404);
    expect((await get("/p/test/a/b.json")).status).toBe(404);
    expect((await get("/p/test/index.json", { method: "POST" })).status).toBe(405);
  });

  it("answers conditional and HEAD requests", async () => {
    const { build, get } = setup();
    await build();
    const first = await get("/p/test/index.json");
    const etag = first.headers.get("etag") as string;
    expect(etag).toBeTruthy();
    const again = await get("/p/test/index.json", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    const head = await get("/p/test/index.json", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("moves to a new build once the isolate's pointer expires", async () => {
    const { build, get } = setup();
    await build();
    const before = (await (await get("/p/test/index.json")).json()) as ShardIndex;
    popular(db, "quiet launch party");
    await build();

    expect(await (await get("/p/test/index.json")).json()).toEqual(before);
    clock += 5 * 60_000;
    const after = (await (await get("/p/test/index.json")).json()) as ShardIndex;
    expect(after).not.toEqual(before);
  });

  it("serves the static shards, never as immutable, until a build exists", async () => {
    const { get } = setup();
    const res = await get("/p/test/index.json");
    expect(await res.json()).toEqual({ static: true });
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await get("/p/test/x.json")).status).toBe(404);
    expect(assets).toHaveBeenCalledTimes(2);
  });

  it("leaves other pack versions to the static assets", async () => {
    const { build, get } = setup();
    await build();
    expect((await get("/p/0.0.9/index.json")).status).toBe(404);
    expect(assets).toHaveBeenCalledWith(`${API}/p/0.0.9/index.json`);
  });

  it("feeds the SDK's shards → API chain with the API's own semantic answers", async () => {
    const { h, build } = setup();
    await build();
    const calls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return h.call(new Request(String(input)));
    }) as typeof globalThis.fetch;

    const layered = createLayeredSemantic({
      shardsUrl: `${API}/p/test`,
      endpoint: API,
      key: TEST_KEY,
      fetch,
    });
    const fromShard = await layered?.search("Lava eruption", { limit: 4 });
    expect(fromShard?.layer).toBe("shard");

    const api = createSemanticClient({ endpoint: API, key: TEST_KEY, fetch });
    const fromApi = await api.search("lava eruption", { limit: 4 });
    expect(fromApi?.layer).toBe("api");
    expect(fromShard?.results).toEqual(fromApi?.results);

    // Not in a shard: the API answers.
    expect((await layered?.search("quiet morning", { limit: 4 }))?.layer).toBe("api");
    // Typed with an accent: the API embeds it as typed, so the shard (folded text) is skipped.
    expect((await layered?.search("lavá eruption", { limit: 4 }))?.layer).toBe("api");
    const shards = createShardProvider({ baseUrl: `${API}/p/test`, fetch });
    expect(await shards.search("lavá eruption")).toBeUndefined();
    expect(calls.filter((url) => url.includes("/v1/search"))).toHaveLength(3);
  });

  it("serves each locale's directory, English also under en/, and 404 for others", async () => {
    popular(db, "lava eruption", 0, "tr");
    const { h, get } = setup();
    await runShardBuild(h.env, withTurkish, { now: clock, limits: { results: 4 } });

    const tr = await get("/p/test/tr/index.json");
    expect(tr.status).toBe(200);
    expect(tr.headers.get("cache-control")).toBe("public, max-age=3600");
    const trIndex = (await tr.json()) as ShardIndex;
    const key = trIndex.keys.find((k) => k.startsWith("l")) as string;
    const shard = (await (await get(`/p/test/tr/${encodeURIComponent(key)}.json`)).json()) as Shard;
    expect(Object.keys(shard.entries)).toEqual(["lava eruption"]);
    // Older clients and new English clients read the same English files.
    expect(await (await get("/p/test/en/index.json")).json()).toEqual(
      await (await get("/p/test/index.json")).json(),
    );
    expect((await get("/p/test/de/index.json")).status).toBe(404);
    expect((await get("/p/test/xx/index.json")).status).toBe(404);
    expect((await get("/p/test/tr/a/index.json")).status).toBe(404);
  });

  it("gives the SDK of each locale the API's answers for that locale", async () => {
    popular(db, "lava eruption", 0, "tr");
    popular(db, "extinct reptiles", 0, "tr");
    const h = harness({
      now: () => clock,
      catalog: withTurkish,
      env: {
        DB: sqliteD1(db) as unknown as D1Database,
        SHARDS: r2.r2,
        AI: { run: batchAi() },
        ASSETS: { fetch: assets },
        SHARDS_CRON_ENABLED: "true",
      },
    });
    await runShardBuild(h.env, withTurkish, { now: clock, limits: { results: 4 } });
    const fetch = (async (input: string | URL | Request) =>
      h.call(new Request(String(input)))) as typeof globalThis.fetch;
    const shards = createShardProvider({ baseUrl: `${API}/p/test`, fetch });
    const fromShard = await shards.search("lava eruption", { locale: "tr", limit: 4 });
    expect(fromShard?.layer).toBe("shard");
    const api = createSemanticClient({ endpoint: API, key: TEST_KEY, fetch });
    const fromApi = await api.search("lava eruption", { locale: "tr", limit: 4 });
    expect(fromShard?.results).toEqual(fromApi?.results);
    // Searched in Turkish only: an English client asks the API.
    expect((await shards.search("extinct reptiles", { locale: "tr" }))?.layer).toBe("shard");
    expect(await shards.search("extinct reptiles", { locale: "en" })).toBeUndefined();
  });

  it("needs no key and never meters", async () => {
    const { h, build, get } = setup();
    await build();
    expect((await get("/p/test/index.json")).status).toBe(200);
    // The meter and key cache are built on the first API call; shard requests never make one.
    expect(h.app.meter).toBeUndefined();
  });
});
