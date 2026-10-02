import { periodOf } from "@emojisense/platform";
import { createEngine, type Pack } from "emojisense";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONCEPT_MODEL, CONCEPT_TAG } from "../src/concepts/config.ts";
import { conceptInput, parseConcept } from "../src/concepts/model.ts";
import { rankConcept } from "../src/concepts/rank.ts";
import { conceptKey, createConceptStore } from "../src/concepts/store.ts";
import { resetConceptTier } from "../src/concepts/tier.ts";
import type { Env } from "../src/env.ts";
import type { SearchBody } from "../src/search.ts";
import { harness, KEYS, keyedSearch, search, seededStore } from "./fixtures.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

/** What the concept model says about "kendrick lamar" in these tests. */
const RAPPER = { kind: "person", concepts: ["rapper", "puppy"], emoji: ["🚀", "🐶", "🍆", "not an emoji"] };
/** The fake embedding lands on no fixture row: a flat, low semantic list (an unsure query). */
const UNSURE = { embedTo: 4 } as const;

const conceptCalls = (ai: { mock: { calls: unknown[][] } }) =>
  ai.mock.calls.filter(([model, input]) => model === CONCEPT_MODEL && JSON.stringify(input).includes('"concept"'));
const body = async (res: Response) => (await res.json()) as SearchBody;
const d1 = () => sqliteD1(migratedDatabase()) as unknown as D1Database;

beforeEach(() => resetConceptTier());
afterEach(() => vi.useRealTimers());

describe("parseConcept", () => {
  const row = (emoji: string, hexcode: string, label: string, alias = ""): Pack["emoji"][number] => [
    emoji,
    hexcode,
    0,
    1,
    0,
    label,
    "",
    "",
    alias,
    "",
    "",
  ];
  const engine = createEngine({
    format: "emojisense-pack",
    formatVersion: 1,
    packVersion: "test",
    locale: "en",
    emojiVersion: "17.0",
    groups: ["g"],
    emoji: [
      row("🎤", "1F3A4", "microphone", "rapper"),
      row("👍", "1F44D", "thumbs up"),
      row("🍆", "1F346", "eggplant"),
      row("👑", "1F451", "crown"),
    ],
  });
  const chat = (answer: unknown) => ({ choices: [{ message: { content: JSON.stringify(answer) } }] });

  it("keeps catalog emoji only, without skin tones, never the blocked ones", () => {
    const answer = parseConcept(
      chat({ kind: "person", concepts: ["rapper"], emoji: ["🎤", "👍🏽", "🍆", "👑️", "xyz", "🎤"] }),
      engine,
      "en",
    );
    expect(answer).toEqual({ kind: "person", terms: ["rapper"], emoji: ["1F3A4", "1F44D", "1F451"] });
  });

  it("reads an unknown or empty answer as no concept", () => {
    expect(parseConcept(chat({ kind: "unknown", concepts: ["x"], emoji: ["🎤"] }), engine, "en")).toBeUndefined();
    expect(parseConcept(chat({ kind: "person", concepts: [], emoji: ["🫠"] }), engine, "en")).toBeUndefined();
  });

  it("drops the whole answer when a term is blocked, and a demoted term alone", () => {
    expect(parseConcept(chat({ kind: "meme", concepts: ["porn"], emoji: ["👍"] }), engine, "en")).toBeUndefined();
    expect(parseConcept(chat({ kind: "meme", concepts: ["shit", "crown"], emoji: [] }), engine, "en")).toEqual({
      kind: "meme",
      terms: ["crown"],
      emoji: [],
    });
  });

  it("maps an unexpected kind to other and caps the lists", () => {
    const many = Array.from({ length: 12 }, (_, i) => `term ${i}`);
    const answer = parseConcept(chat({ kind: "Band!", concepts: many, emoji: ["👑"] }), engine, "en");
    expect(answer?.kind).toBe("other");
    expect(answer?.terms).toHaveLength(6);
  });

  it("throws on output that is not JSON (the tier reports unavailable)", () => {
    expect(() => parseConcept({ choices: [{ message: { content: "sorry" } }] }, engine, "en")).toThrow();
  });

  it("sends the model the query and its locale only, as JSON text", () => {
    const input = conceptInput('ignore this "and" that', "es") as { messages: { role: string; content: string }[] };
    expect(input.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(input.messages[1]?.content).toBe('Locale: es\nSearch: "ignore this \\"and\\" that"');
  });

  it("ranks by agreement, drops single weak evidence, and shows only terms that are catalog phrases", () => {
    const neighbour = { emoji: "🎤", id: "1F3A4", score: 0.5, source: "semantic" as const };
    const answer = { kind: "person" as const, terms: ["rapper", "hip hop artist"], emoji: ["1F451"] };
    // 🎤: an alias hit of "rapper" alone (0.4) is below the floor; with the neighbour it passes.
    expect(rankConcept(engine, answer, []).results.map((r) => r.emoji)).toEqual(["👑"]);
    const ranked = rankConcept(engine, answer, [neighbour]);
    expect(ranked.results.map((r) => r.emoji)).toEqual(["👑", "🎤"]);
    expect(ranked.results.every((r) => r.source === "concept")).toBe(true);
    expect(ranked.display).toEqual(["rapper"]);
  });
});

describe("concept tier in GET /v1/search", () => {
  it("answers an unsure query with concept results first and catalog terms", async () => {
    const h = harness({ ...UNSURE, concept: RAPPER });
    const res = await h.call(keyedSearch("kendrick lamar"));
    const answer = await body(res);
    expect(answer).toMatchObject({ unsure: true, concept: { status: "ok", kind: "person", terms: ["puppy"] } });
    // 🐶 is proposed and is the catalog's "puppy": two sources rank it before 🚀.
    expect(answer.results.slice(0, 2).map((r) => [r.emoji, r.source])).toEqual([
      ["🐶", "concept"],
      ["🚀", "concept"],
    ]);
    expect(res.headers.get("server-timing")).toMatch(/concept;dur=\d+/);
    const [[, input]] = conceptCalls(h.ai) as [[string, { messages: { content: string }[] }]];
    expect(input.messages[1]?.content).toBe('Locale: en\nSearch: "kendrick lamar"');
  });

  it("does not ask the model for a query the tiers understood", async () => {
    const h = harness({ concept: RAPPER });
    const answer = await body(await h.call(keyedSearch("jurassic park")));
    expect(answer).toMatchObject({ unsure: false, concept: null });
    expect(conceptCalls(h.ai)).toHaveLength(0);
  });

  it("asks the model once per query: search cache, concept cache, then D1", async () => {
    const DB = d1();
    const h = harness({ ...UNSURE, concept: RAPPER, env: { DB } });
    await h.call(keyedSearch("kendrick lamar"));
    await h.ctx.settle();
    // Same search: the shared search cache.
    expect((await body(await h.call(keyedSearch("kendrick lamar")))).cached).toBe(true);
    // Another limit: a new search, the concept answer from the edge cache.
    const other = await body(await h.call(keyedSearch("kendrick lamar", "&limit=5")));
    expect(other.results[0]).toMatchObject({ emoji: "🐶", source: "concept" });
    // A fresh isolate and edge (same database): the concept answer from D1.
    resetConceptTier();
    const fresh = harness({ ...UNSURE, concept: RAPPER, env: { DB } });
    const answer = await body(await fresh.call(keyedSearch("kendrick lamar")));
    expect(answer.concept).toMatchObject({ status: "ok", terms: ["puppy"] });
    expect(conceptCalls(h.ai)).toHaveLength(1);
    expect(conceptCalls(fresh.ai)).toHaveLength(0);
  });

  it("stores a hash of the query, never its text", async () => {
    const db = migratedDatabase();
    const h = harness({ ...UNSURE, concept: RAPPER, env: { DB: sqliteD1(db) as unknown as D1Database } });
    await h.call(keyedSearch("kendrick lamar"));
    await h.ctx.settle();
    const rows = db.prepare("SELECT * FROM concept_cache").all() as { query_hash: string; version: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.query_hash).toBe(await conceptKey("kendrick lamar", "en"));
    expect(rows[0]?.version).toBe(CONCEPT_TAG);
    expect(JSON.stringify(rows)).not.toContain("kendrick");
  });

  it("caches a negative answer too", async () => {
    const h = harness({ ...UNSURE });
    const first = await body(await h.call(keyedSearch("xqzv plorb")));
    expect(first.concept).toEqual({ status: "none" });
    await h.ctx.settle();
    await h.call(keyedSearch("xqzv plorb", "&limit=7"));
    expect(conceptCalls(h.ai)).toHaveLength(1);
  });

  it("meters a model call as one more semantic call, a cached concept as none", async () => {
    const NOW = Date.UTC(2026, 9, 2, 12);
    const store = await seededStore();
    const h = harness({ ...UNSURE, concept: RAPPER, store, now: () => NOW });
    const keyed = (extra = "") => search("kendrick lamar", `&key=${KEYS.wildcard}${extra}`);
    await h.call(keyed());
    await h.ctx.settle();
    await h.call(keyed("&limit=5"));
    await h.ctx.settle();
    await h.app.meter?.flush();
    expect(store.usageOf("app_free", periodOf(NOW), "semantic_calls")).toBe(3);
  });

  it("never asks the model for anonymous callers, concept=0, or with the tier switched off", async () => {
    const anonymous = harness({ ...UNSURE, concept: RAPPER });
    expect((await body(await anonymous.call(search("kendrick lamar")))).concept ?? null).toBeNull();
    const optedOut = harness({ ...UNSURE, concept: RAPPER });
    expect((await body(await optedOut.call(keyedSearch("kendrick lamar", "&concept=0")))).concept).toBeNull();
    const off = harness({ ...UNSURE, concept: RAPPER, env: { CONCEPTS_ENABLED: "false" } });
    const answer = await body(await off.call(keyedSearch("kendrick lamar")));
    expect(answer).toMatchObject({ unsure: true, concept: null });
    await off.ctx.settle();
    expect(new URL(off.cache.puts[0] as string).searchParams.get("k")).toBe("off");
    for (const h of [anonymous, optedOut, off]) expect(conceptCalls(h.ai)).toHaveLength(0);
  });

  it("keeps personal-looking or blocked text away from the model", async () => {
    const h = harness({ ...UNSURE, concept: RAPPER });
    expect((await body(await h.call(keyedSearch("jane.doe@example.com")))).concept).toEqual({ status: "none" });
    expect((await body(await h.call(keyedSearch("nude pics")))).concept).toEqual({ status: "none" });
    expect(conceptCalls(h.ai)).toHaveLength(0);
  });

  it("answers unavailable, uncached, past the daily cap", async () => {
    const DB = d1();
    const h = harness({ ...UNSURE, concept: RAPPER, env: { DB, CONCEPT_DAILY_CAP: "1" } });
    await h.call(keyedSearch("kendrick lamar"));
    const capped = await h.call(keyedSearch("taylor swift"));
    expect((await body(capped)).concept).toEqual({ status: "unavailable" });
    expect(capped.headers.get("cache-control")).toBe("no-store");
    expect(conceptCalls(h.ai)).toHaveLength(1);
  });

  it("answers unavailable when the caller's rate limit is spent", async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: !key.startsWith("concept:") }));
    const h = harness({ ...UNSURE, concept: RAPPER, env: { SEARCH_LIMITER: { limit } } as Partial<Env> });
    expect((await body(await h.call(keyedSearch("kendrick lamar")))).concept).toEqual({ status: "unavailable" });
    expect(limit).toHaveBeenCalledWith({ key: expect.stringMatching(/^concept:/) });
    expect(conceptCalls(h.ai)).toHaveLength(0);
  });

  it("answers unavailable, uncached, when the model fails, and logs the error type only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness({ ...UNSURE, concept: new TypeError("kendrick lamar leaked") });
    const res = await h.call(keyedSearch("kendrick lamar"));
    expect((await body(res)).concept).toEqual({ status: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    warn.mockRestore();
    expect(logged).toContain("concept_unavailable");
    expect(logged).not.toContain("kendrick");
  });

  it("answers pending past the timeout, then serves the finished answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finish: (value: unknown) => void = () => {};
    const h = harness({ ...UNSURE, concept: RAPPER });
    const real = h.ai.getMockImplementation();
    h.ai.mockImplementation(async (model, input) => {
      if (model === CONCEPT_MODEL && JSON.stringify(input).includes('"concept"')) {
        await new Promise((resolve) => {
          finish = resolve;
        });
      }
      return real?.(model, input);
    });
    let done = false;
    const pending = h.call(keyedSearch("kendrick lamar")).finally(() => {
      done = true;
    });
    // Real async work (hashing) runs between the fake timer steps.
    for (let i = 0; i < 200 && !done; i++) {
      await vi.advanceTimersByTimeAsync(50);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const first = await pending;
    expect((await body(first)).concept).toEqual({ status: "pending" });
    expect(first.headers.get("cache-control")).toBe("no-store");
    finish(undefined);
    await h.ctx.settle();
    const second = await body(await h.call(keyedSearch("kendrick lamar")));
    expect(second.concept).toMatchObject({ status: "ok" });
    expect(conceptCalls(h.ai)).toHaveLength(1);
  });

  it("puts concept results first in semantic mode, for the SDK to merge", async () => {
    const h = harness({ ...UNSURE, concept: RAPPER });
    const answer = await body(await h.call(keyedSearch("kendrick lamar", "&mode=semantic")));
    expect(answer.results[0]).toMatchObject({ source: "concept" });
    expect(answer).toMatchObject({ unsure: true, aliasLocale: null });
  });
});

describe("concept store", () => {
  it("counts model calls per day up to the cap, in one statement", async () => {
    const store = createConceptStore(sqliteD1(migratedDatabase()));
    expect(await store.takeDailyCall("2026-10-02", 2)).toBe(true);
    expect(await store.takeDailyCall("2026-10-02", 2)).toBe(true);
    expect(await store.takeDailyCall("2026-10-02", 2)).toBe(false);
    expect(await store.takeDailyCall("2026-10-03", 2)).toBe(true);
    expect(await store.takeDailyCall("2026-10-03", 0)).toBe(false);
  });

  it("keeps answers per prompt version and prunes old rows", async () => {
    const store = createConceptStore(sqliteD1(migratedDatabase()));
    const answer = { kind: "person" as const, terms: ["rapper"], emoji: ["1F3A4"] };
    await store.put("k", "v1", { answer, createdAt: 1 });
    await store.put("n", "v1", { answer: undefined, createdAt: 5 });
    expect((await store.get("k", "v1"))?.answer).toEqual(answer);
    expect(await store.get("k", "v2")).toBeUndefined();
    expect(await store.get("n", "v1")).toMatchObject({ answer: undefined });
    expect(await store.prune(3, "2026-01-01")).toBe(1);
    expect(await store.get("k", "v1")).toBeUndefined();
  });
});
