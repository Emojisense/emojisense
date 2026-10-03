import type { ShardIndex } from "@emojisense/data/shards";
import { createLayeredSemantic } from "emojisense";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import type { CacheLike } from "../src/context.ts";
import type { AiBinding, Env } from "../src/env.ts";
import { runShardBuild } from "../src/shards/job.ts";
import type { ShardPointer } from "../src/shards/storage.ts";
import { createD1Store, type D1Like } from "../src/store.ts";
import { buildRegionalTrends, readRegionalTrends } from "../src/trends.ts";
import { API, catalog, executionContext, ROW, unit } from "./fixtures.ts";

/**
 * The nightly build and the /p/* route against Miniflare's local R2 and D1 (the `offline` env of
 * wrangler.jsonc, nothing persisted, no remote bindings): R2 list pages, delimiters and ETags as
 * the runtime implements them, not as the in-memory stand-in assumes.
 */
const NOW = Date.UTC(2026, 9, 15, 4, 23);
const migrations = Object.entries(
  import.meta.glob<string>("../../platform/migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

/**
 * The part of wrangler's API used here. Imported at run time: its Node typings would replace the
 * Workers types the tests are checked against.
 */
interface Wrangler {
  getPlatformProxy<E>(options: {
    configPath: string;
    environment: string;
    persist: boolean;
    remoteBindings: boolean;
  }): Promise<{ env: E; caches: { default: CacheLike }; dispose(): Promise<void> }>;
  unstable_splitSqlQuery(sql: string): string[];
}
const WRANGLER = "wrangler";

const ai = vi.fn<AiBinding["run"]>(async (_model, input) => ({
  data: (input as { text: string[] }).text.map((t) =>
    Array.from(unit(/lava/.test(t) ? ROW.volcano : /launch/.test(t) ? ROW.rocket : ROW.dog)),
  ),
}));

describe("shards and regional stats on Miniflare R2 and D1", () => {
  let proxy: { env: Env; caches: { default: CacheLike }; dispose(): Promise<void> };
  let env: Env;

  beforeAll(async () => {
    const { getPlatformProxy, unstable_splitSqlQuery } = (await import(
      /* @vite-ignore */ WRANGLER
    )) as Wrangler;
    proxy = await getPlatformProxy<Env>({
      configPath: decodeURIComponent(new URL("../wrangler.jsonc", import.meta.url).pathname),
      environment: "offline",
      persist: false,
      remoteBindings: false,
    });
    env = { ...proxy.env, AI: { run: ai }, SHARDS_CRON_ENABLED: "true" };
    const db = env.DB as D1Database;
    for (const sql of migrations.flatMap((file) => unstable_splitSqlQuery(file))) await db.prepare(sql).run();
    const day = "2026-10-14";
    for (const id of ["a", "b", "c"]) {
      await db
        .prepare("INSERT INTO accounts (id, created_at, plan) VALUES (?, 0, 'pro')")
        .bind(`acc_${id}`)
        .run();
      await db
        .prepare("INSERT INTO apps (id, account_id, name, plan, created_at) VALUES (?, ?, 'App', 'pro', 0)")
        .bind(`app_${id}`, `acc_${id}`)
        .run();
      for (const q of ["lava eruption", "launch party", "the end of the world"]) {
        await db
          .prepare("INSERT INTO query_daily (app_id, day, query, searches, misses) VALUES (?, ?, ?, 5, 0)")
          .bind(`app_${id}`, day, q)
          .run();
      }
    }
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  }, 120_000);

  afterAll(async () => {
    await proxy?.dispose();
  });

  it("publishes, rebuilds idempotently, prunes and serves through the SDK chain", async () => {
    const bucket = env.CDN as R2Bucket;
    const run = (limits = {}) => runShardBuild(env, catalog, { now: NOW, limits: { results: 4, ...limits } });

    // A budget of one entry per file and one embedding per night: three builds in three runs.
    const first = await run({ maxEmbeddings: 1, maxShardBytes: 50 });
    const second = await run({ maxEmbeddings: 1, maxShardBytes: 50 });
    const third = await run({ maxEmbeddings: 1, maxShardBytes: 50 });
    expect([first.queries, second.queries, third.queries]).toEqual([1, 2, 3]);
    const again = await run({ maxEmbeddings: 1, maxShardBytes: 50 });
    expect(again).toMatchObject({ status: "unchanged", build: third.build, embedded: 0 });

    const pointer = (await (await bucket.get("state/test/c0ffee.json"))?.json()) as ShardPointer;
    expect(pointer).toMatchObject({ build: third.build, previous: { build: second.build }, queries: 3 });
    // One file per entry, named by content: each build reuses the files of the one before.
    const files = await bucket.list({ prefix: "p/test/f/" });
    expect(files.objects).toHaveLength(3);
    const head = await bucket.head(files.objects[0]?.key as string);
    expect(head?.httpMetadata?.cacheControl).toBe("public, max-age=31536000, immutable");

    const app = createApp({ catalog, cache: () => proxy.caches.default });
    const ctx = executionContext();
    const fetch = (async (input: string | URL | Request) =>
      app.fetch(new Request(String(input)), env, ctx)) as typeof globalThis.fetch;
    const index = (await (await fetch(`${API}/p/test/index.json`)).json()) as ShardIndex;
    expect(index.keys).toEqual(["launch party", "lava eruption", "the end of the world"]);
    const spaced = await fetch(`${API}/p/test/the%20end%20of%20the%20world.json`);
    expect(spaced.status).toBe(200);
    expect(spaced.headers.get("etag")).toBeTruthy();

    const layered = createLayeredSemantic({ shardsUrl: `${API}/p/test`, endpoint: API, fetch });
    const hit = await layered?.search("Lava eruption", { limit: 4 });
    expect(hit?.layer).toBe("shard");
    expect(hit?.results[0]?.emoji).toBe("🌋");
    await ctx.settle();
  }, 120_000);

  it("counts searches per locale and country and writes regional trends on real D1", async () => {
    const db = env.DB as unknown as D1Like;
    const store = createD1Store(db);
    const day = "2026-10-14";
    // Two flushes of the same rows: the upsert adds to the row of each locale and country.
    for (let i = 0; i < 2; i++) {
      await store.addQueryCounts(
        ["a", "b", "c"].map((id) => ({
          appId: `app_${id}`,
          day,
          query: "copa do mundo",
          locale: "pt",
          country: "BR",
          searches: 3,
          misses: 0,
        })),
      );
    }
    const report = await buildRegionalTrends(db, NOW);
    expect(report).toMatchObject({ rows: 2, regions: 2 });
    const rows = await readRegionalTrends(db, { locale: "pt" });
    expect(rows.map((r) => [r.country, r.query, r.searches, r.accounts])).toEqual([
      ["*", "copa do mundo", 18, 3],
      ["BR", "copa do mundo", 18, 3],
    ]);
  }, 120_000);
});
