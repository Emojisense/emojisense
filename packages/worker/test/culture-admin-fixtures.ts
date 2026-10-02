/**
 * Fixtures for culture Phase 2: a small English pack, the real exclusions and prompt, an in-house
 * style gate suite, deployed culture files behind a fake ASSETS binding, D1 and R2 in memory and
 * a scripted Workers AI.
 */
import type { DatabaseSync } from "node:sqlite";
import exclusionsText from "@emojisense/data/culture/exclusions.txt?raw";
import promptText from "@emojisense/data/culture/prompts/propose.v2.md?raw";
import { type CultureRecord, compileCulture } from "@emojisense/data/culture-core";
import type { CultureAdminRpc, CultureReviewer } from "@emojisense/platform";
import { type Culture, createEngine, type Pack, type PackRow } from "emojisense";
import { vi } from "vitest";
import { createCultureRuntime } from "../src/culture-admin/bundle.ts";
import type { CultureRuntime } from "../src/culture-admin/runtime.ts";
import { createCultureAdmin } from "../src/culture-admin/service.ts";
import type { AiBinding, Env } from "../src/env.ts";
import { memoryR2 } from "./memory-r2.ts";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1.ts";

export const PACK_VERSION = "test";
/** The cron's scheduled time: 2026-10-15 04:41 UTC. */
export const NOW = Date.UTC(2026, 9, 15, 4, 41);
export const TODAY = "2026-10-15";

const row = (emoji: string, hexcode: string, label: string, alias = ""): PackRow => [
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

export const pack: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: PACK_VERSION,
  locale: "en",
  emojiVersion: "17.0",
  groups: ["g"],
  emoji: [
    row("🐐", "1F410", "goat", "greatest of all time"),
    row("⚽", "26BD", "soccer ball", "football|soccer"),
    row("🏆", "1F3C6", "trophy", "cup|champion|final"),
    row("🎃", "1F383", "jack-o-lantern", "halloween|pumpkin"),
    row("👻", "1F47B", "ghost", "spooky|boo"),
    row("🦖", "1F996", "T-Rex", "jurassic park|dinosaur"),
    row("🎉", "1F389", "party popper", "party|celebrate"),
    row("🌋", "1F30B", "volcano", "eruption"),
  ],
};

/** The gate suite: canonical answers the culture layer must keep. "zxqv" has none. */
export const GATE_QUERIES = [
  { id: "q-goat", q: "goat", locale: "en", cat: "exact", answers: ["🐐"] },
  { id: "q-football", q: "football", locale: "en", cat: "exact", answers: ["⚽"] },
  { id: "q-halloween", q: "halloween", locale: "en", cat: "exact", answers: ["🎃"] },
  { id: "q-none", q: "zxqv", locale: "en", cat: "miss", answers: [] },
]
  .map((q) => JSON.stringify(q))
  .join("\n");

export const CALENDAR = {
  format: "emojisense-culture-sources",
  kind: "events",
  note: "test",
  items: [
    {
      id: "cup-final",
      title: { en: "Cup final" },
      category: "sport",
      regions: ["*"],
      locales: ["en"],
      dates: [{ from: "2026-10-25", to: "2026-10-25" }],
      basis: "listed by the organiser",
      hint: "football cup final, trophy",
      emoji: ["1F3C6", "26BD"],
    },
  ],
} as const;

export const engine = createEngine(pack);

export function runtime(overrides: Partial<CultureRuntime> = {}): CultureRuntime {
  return {
    ...createCultureRuntime({
      packVersion: PACK_VERSION,
      packRows: pack.emoji,
      exclusions: exclusionsText,
      prompt: promptText,
      gateQueries: GATE_QUERIES,
      sources: [CALENDAR as never],
      engine: async (locale) => (locale === "en" ? engine : undefined),
    }),
    ...overrides,
  };
}

export const record = (overrides: Partial<CultureRecord> = {}): CultureRecord => ({
  id: "goat-football",
  status: "approved",
  kind: "lasting",
  context: { en: "Football's greatest-of-all-time debate" },
  when: null,
  regions: ["*"],
  locales: ["en"],
  triggers: { en: ["goat"] },
  emoji: [{ hexcode: "26BD", weight: 0.6 }],
  source: "editorial",
  createdBy: "test",
  reviewedBy: "editor",
  createdAt: "2026-10-01",
  ...overrides,
});

/** A deployed culture file set (what the Worker sync ships), built from git records. */
export function deployedFiles(records: readonly CultureRecord[], from = "2026-10-14") {
  const catalog = new Map(pack.emoji.map((r) => [r[1], r[0]]));
  const culture: Culture = compileCulture(records, "en", { packVersion: PACK_VERSION, from, catalog });
  const json = JSON.stringify(culture);
  const index = {
    format: "emojisense-culture-index",
    formatVersion: 1,
    packVersion: PACK_VERSION,
    from: culture.from,
    until: culture.until,
    locales: { en: { entries: culture.entries.length, bytes: json.length, gzipBytes: 0 } },
  };
  return new Map([
    [`/v1/culture/${PACK_VERSION}/culture.en.json`, json],
    [`/v1/culture/${PACK_VERSION}/index.json`, `${JSON.stringify(index, null, 2)}\n`],
  ]);
}

/** ASSETS that serve `files` (path → body); everything else is a 404. Records each URL. */
export function fakeAssets(files: Map<string, string>) {
  const urls: string[] = [];
  return {
    urls,
    files,
    binding: {
      async fetch(input: string) {
        urls.push(input);
        const body = files.get(new URL(input).pathname);
        return body === undefined
          ? new Response("not found", { status: 404 })
          : new Response(body, { headers: { "Content-Type": "application/json", ETag: '"asset"' } });
      },
    },
  };
}

/** Workers AI that answers each call from `answer(prompt)`; records the prompts it got. */
export function scriptedAi(answer: (user: string) => unknown) {
  const prompts: string[] = [];
  const run = vi.fn<AiBinding["run"]>(async (_model, input) => {
    const messages = (input as { messages: { role: string; content: string }[] }).messages;
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    prompts.push(user);
    return { choices: [{ message: { content: JSON.stringify(answer(user)) } }] };
  });
  return { run, prompts, binding: { run } as AiBinding };
}

export const REVIEWER: CultureReviewer = { accountId: "acc_admin", name: "Ada Editor" };

export interface CultureWorld {
  db: DatabaseSync;
  r2: ReturnType<typeof memoryR2>;
  assets: ReturnType<typeof fakeAssets>;
  env: Env;
  runtime: CultureRuntime;
  admin: CultureAdminRpc;
  clock: { now: number };
}

/** A database with the admin account, deployed files from `git`, empty R2. */
export function world(
  options: { git?: CultureRecord[]; ai?: AiBinding; env?: Partial<Env> } = {},
): CultureWorld {
  const db = migratedDatabase();
  db.exec("INSERT INTO accounts (id, created_at, plan) VALUES ('acc_admin', 0, 'free')");
  const clock = { now: NOW };
  const r2 = memoryR2(() => clock.now);
  const assets = fakeAssets(deployedFiles(options.git ?? [record()]));
  const env: Env = {
    DB: sqliteD1(db) as unknown as D1Database,
    SHARDS: r2.r2,
    ASSETS: assets.binding,
    CULTURE_CRON_ENABLED: "true",
    CULTURE_PROPOSE_BUDGET: "5",
    ...(options.ai ? { AI: options.ai } : {}),
    ...options.env,
  };
  const rt = runtime();
  return { db, r2, assets, env, runtime: rt, admin: createCultureAdmin(env, rt, () => clock.now), clock };
}

/** Inserts a draft proposal directly (as the nightly job would) and returns its id. */
export function insertDraft(db: DatabaseSync, draft: CultureRecord, id = `p_${draft.id}`): string {
  const evidence = {
    origin: "trend",
    trends: [],
    model: "test",
    prompt: "propose.v2",
    gate: { queries: 0, triggers: 0 },
    droppedTriggers: [],
    warnings: [],
  };
  db.prepare(
    `INSERT INTO culture_proposals (id, entry_id, status, record, evidence, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
  ).run(id, draft.id, JSON.stringify(draft), JSON.stringify(evidence), NOW, NOW);
  return id;
}

/** The regional trends table (migration 0004 of the regional work), for databases without it. */
export function createTrendsTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS trends_daily (
    day TEXT NOT NULL, locale TEXT NOT NULL, country TEXT NOT NULL, query TEXT NOT NULL,
    score REAL NOT NULL, searches INTEGER NOT NULL, accounts INTEGER NOT NULL,
    PRIMARY KEY (day, locale, country, query))`);
}

export function addTrend(
  db: DatabaseSync,
  row: { day?: string; locale?: string; country?: string; query: string; score: number; searches?: number },
) {
  db.prepare(
    "INSERT INTO trends_daily (day, locale, country, query, score, searches, accounts) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    row.day ?? TODAY,
    row.locale ?? "en",
    row.country ?? "*",
    row.query,
    row.score,
    row.searches ?? 40,
    5,
  );
}
