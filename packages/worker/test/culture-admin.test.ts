import { assertCulture, type Culture } from "emojisense";
import { beforeEach, describe, expect, it } from "vitest";
import { assetCultureReader, createCultureFiles } from "../src/culture.ts";
import {
  CULTURE_LIVE_GZIP_BUDGET,
  CULTURE_NIGHTLY_CRON,
  CULTURE_SYNC_CRON,
} from "../src/culture-admin/config.ts";
import { proposalBudget, runCultureProposals } from "../src/culture-admin/propose.ts";
import { runCulturePublish, runCultureSync } from "../src/culture-admin/publish.ts";
import {
  createCultureOverride,
  createCultureRoute,
  overrideCultureReader,
} from "../src/culture-admin/route.ts";
import { reviewerName } from "../src/culture-admin/service.ts";
import { readCulturePointer } from "../src/culture-admin/storage.ts";
import { runScheduled } from "../src/scheduled.ts";
import {
  addTrend,
  type CultureWorld,
  deployedFiles,
  insertDraft,
  NOW,
  PACK_VERSION,
  REVIEWER,
  record,
  scriptedAi,
  TODAY,
  world,
} from "./culture-admin-fixtures.ts";
import { catalog, memoryCache } from "./fixtures.ts";

const CUP_FINAL_ANSWER = {
  skip: false,
  reason: "",
  id: "ignored-for-calendar",
  kind: "event",
  days: 0,
  context: { en: "The football cup final" },
  triggers: { en: ["cup final", "final match"] },
  emoji: [
    { hexcode: "1F3C6", weight: 0.8 },
    { hexcode: "26BD", weight: 0.6 },
  ],
};

/** The model's answer per source, by what the prompt shows. */
function answers(user: string): unknown {
  if (user.includes('"Cup final"')) return CUP_FINAL_ANSWER;
  if (user.includes('"phrase": "spooky season"')) {
    return {
      skip: false,
      reason: "",
      id: "spooky-season",
      kind: "event",
      days: 20,
      context: { en: "The weeks before Halloween" },
      triggers: { en: ["spooky season"] },
      emoji: [
        { hexcode: "1F47B", weight: 0.8 },
        { hexcode: "1F383", weight: 0.7 },
      ],
    };
  }
  if (user.includes('"phrase": "spooky week"')) {
    // "zxqv" has no canonical answer: the culture emoji would become its top answer.
    return {
      skip: false,
      reason: "",
      id: "spooky-week",
      kind: "event",
      days: 7,
      context: { en: "A week of ghost stories" },
      triggers: { en: ["spooky week", "zxqv"] },
      emoji: [{ hexcode: "1F47B", weight: 0.7 }],
    };
  }
  if (user.includes('"phrase": "pumpkin spice"')) {
    return {
      skip: false,
      reason: "",
      id: "pumpkin-spice",
      kind: "lasting",
      days: 0,
      context: { en: "Pumpkin spice drinks in election season" },
      triggers: { en: ["pumpkin spice"] },
      emoji: [{ hexcode: "1F383", weight: 0.7 }],
    };
  }
  if (user.includes('"phrase": "dinosaur week"')) {
    // Only an emoji outside the candidate list: nothing usable remains.
    return {
      skip: false,
      reason: "",
      id: "dino-week",
      kind: "event",
      days: 10,
      context: { en: "A week of dinosaur films" },
      triggers: { en: ["dino week"] },
      emoji: [{ hexcode: "1F9FF", weight: 0.9 }],
    };
  }
  return { skip: true, reason: "not sure what it refers to" };
}

describe("nightly culture proposals", () => {
  let w: CultureWorld;
  let ai: ReturnType<typeof scriptedAi>;

  beforeEach(() => {
    ai = scriptedAi(answers);
    w = world({ ai: ai.binding });
  });

  it("drafts from the calendar and rising searches, stores drafts with evidence, approves nothing", async () => {
    addTrend(w.db, { query: "spooky season", score: 6, country: "US" });
    addTrend(w.db, { query: "spooky season", score: 4, country: "GB" });
    addTrend(w.db, { query: "steady thing", score: 1.1 });
    addTrend(w.db, { query: "old news", score: 9, day: "2026-10-10" });

    const report = await runCultureProposals(w.env, w.runtime, { now: NOW });
    expect(report).toMatchObject({
      status: "done",
      candidates: { calendar: 1, trend: 1 },
      calls: 2,
      stored: 2,
    });

    const overview = await w.admin.overview({});
    expect(overview.counts).toEqual({ draft: 2, approved: 0, rejected: 0 });
    expect(overview.live).toEqual([]);
    const byId = new Map(overview.proposals.map((p) => [p.entryId, p]));

    const cup = byId.get("cup-final-2026");
    expect(cup?.record).toMatchObject({
      status: "draft",
      kind: "event",
      when: { from: "2026-10-18", to: "2026-10-25" },
      source: "calendar",
      featured: true,
      triggers: { en: ["cup final", "final match"] },
    });
    expect(cup?.evidence).toMatchObject({
      origin: "calendar",
      source: { id: "cup-final", title: "Cup final" },
    });

    const spooky = byId.get("spooky-season");
    expect(spooky?.record).toMatchObject({
      status: "draft",
      kind: "event",
      when: { from: TODAY, to: "2026-11-03" },
      regions: ["GB", "US"],
      locales: ["en"],
      source: "ai-proposed",
    });
    expect(spooky?.record.createdBy).toMatch(
      /^workers-ai:@cf\/google\/gemma-4-26b-a4b-it prompt:propose\.v2/,
    );
    expect(spooky?.evidence.trends?.map((t) => [t.country, t.score])).toEqual([
      ["US", 6],
      ["GB", 4],
    ]);
    expect(spooky?.evidence.gate.queries).toBeGreaterThan(0);

    // JSON mode with the strict schema of the listed locales; no reasoning tokens.
    const input = ai.run.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("never sends an excluded phrase (politics, tragedy) to the model", async () => {
    addTrend(w.db, { query: "vote for bob", score: 9 });
    addTrend(w.db, { query: "earthquake relief", score: 8 });
    addTrend(w.db, { query: "spooky season", score: 3 });
    const report = await runCultureProposals(w.env, w.runtime, { now: NOW });
    expect(report.candidates.trend).toBe(1);
    expect(ai.prompts.join("\n")).not.toMatch(/vote for bob|earthquake/);
  });

  it("drops drafts that fail validation: politics in the text, emoji outside the catalog", async () => {
    addTrend(w.db, { query: "pumpkin spice", score: 5 });
    addTrend(w.db, { query: "dinosaur week", score: 4 });
    const report = await runCultureProposals(w.env, w.runtime, { now: NOW });
    expect(report.invalid).toBe(2);
    const entries = (await w.admin.overview({})).proposals.map((p) => p.entryId);
    expect(entries).not.toContain("pumpkin-spice");
    expect(entries).not.toContain("dino-week");
  });

  it("drops a draft that would change a canonical top answer (culture gate)", async () => {
    addTrend(w.db, { query: "spooky week", score: 5 });
    const report = await runCultureProposals(w.env, w.runtime, { now: NOW });
    expect(report).toMatchObject({ gated: 1, stored: 1 });
    expect((await w.admin.overview({})).proposals.map((p) => p.entryId)).toEqual(["cup-final-2026"]);
  });

  it("dedupes against deployed entries, earlier proposals and taken triggers", async () => {
    // "goat" belongs to the deployed goat-football entry; the second night repeats nothing.
    addTrend(w.db, { query: "goat", score: 7 });
    addTrend(w.db, { query: "spooky season", score: 3 });
    const first = await runCultureProposals(w.env, w.runtime, { now: NOW });
    expect(first.candidates.trend).toBe(1);
    const second = await runCultureProposals(w.env, w.runtime, { now: NOW + 86_400_000 });
    expect(second).toMatchObject({ candidates: { calendar: 0, trend: 0 }, calls: 0, stored: 0 });
    expect((await w.admin.overview({})).counts.draft).toBe(2);
  });

  it("keeps to the nightly budget", async () => {
    for (const q of ["party one", "party two", "party three", "party four", "party five", "party six"]) {
      addTrend(w.db, { query: q, score: 5, country: "*" });
    }
    w.env.CULTURE_PROPOSE_BUDGET = "3";
    const report = await runCultureProposals(w.env, w.runtime, { now: NOW });
    expect(report.calls).toBe(3);
    expect(ai.run).toHaveBeenCalledTimes(3);
    expect(proposalBudget({ CULTURE_PROPOSE_BUDGET: "9999" })).toBe(100);
    expect(proposalBudget({})).toBe(12);
  });

  it("skips when switched off or without Workers AI, and drafts from the calendar without trends", async () => {
    expect(
      (await runCultureProposals({ ...w.env, CULTURE_CRON_ENABLED: "false" }, w.runtime, { now: NOW }))
        .reason,
    ).toBe("disabled");
    const { AI: _, ...withoutAi } = w.env;
    expect((await runCultureProposals(withoutAi, w.runtime, { now: NOW })).reason).toBe("no Workers AI");
    const bare = world({ ai: ai.binding });
    const report = await runCultureProposals(bare.env, bare.runtime, { now: NOW });
    expect(report).toMatchObject({ status: "done", candidates: { trend: 0, calendar: 1 } });
  });

  it("counts a failed Workers AI call and goes on", async () => {
    const failing = world({ ai: { run: async () => Promise.reject(new TypeError("network")) } });
    const report = await runCultureProposals(failing.env, failing.runtime, { now: NOW });
    expect(report).toMatchObject({ calls: 1, failedCalls: 1, stored: 0 });
  });
});

describe("culture admin review", () => {
  let w: CultureWorld;
  const draft = record({
    id: "spooky-season",
    status: "draft",
    kind: "event",
    when: { from: "2026-10-15", to: "2026-11-03" },
    context: { en: "The weeks before Halloween" },
    triggers: { en: ["spooky season", "spooky"] },
    emoji: [
      { hexcode: "1F47B", weight: 0.8 },
      { hexcode: "1F383", weight: 0.7 },
    ],
    regions: ["US", "GB"],
    source: "ai-proposed",
    createdBy: "workers-ai:test prompt:propose.v2 job:nightly",
    reviewedBy: undefined,
  });

  beforeEach(() => {
    w = world();
  });

  it("previews each trigger: the canonical answer, with the entry, and in and out of its regions", async () => {
    const id = insertDraft(w.db, draft);
    const result = await w.admin.proposal(id);
    if (!result.ok) throw new Error(result.message);
    const { preview } = result.value;
    expect(preview.issues).toEqual([]);
    expect(preview.gate.failed).toBe(false);
    const spooky = preview.locales[0]?.triggers.find((t) => t.trigger === "spooky");
    expect(spooky?.canonical[0]?.emoji).toBe("👻");
    expect(spooky?.boosted.map((r) => r.emoji)).toEqual(["👻", "🎃"]);
    expect(spooky?.regions).toEqual([
      {
        region: "US",
        inScope: true,
        results: expect.arrayContaining([expect.objectContaining({ emoji: "🎃" })]),
      },
      { region: "DE", inScope: false, results: [{ emoji: "👻", hexcode: "1F47B", culture: false }] },
    ]);
  });

  it("approves a valid draft: the entry goes live with the editor's name, never an email", async () => {
    const id = insertDraft(w.db, draft);
    const result = await w.admin.approve(id, {
      reviewer: { ...REVIEWER, name: "ada@example.com" },
      reason: "fits",
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.proposal.status).toBe("approved");
    expect(result.value.live).toMatchObject({ id: "spooky-season", status: "approved", reviewerName: "ada" });
    expect(result.value.live.record).toMatchObject({
      status: "approved",
      reviewedBy: "ada",
      source: "ai-proposed",
    });
    expect(reviewerName({ accountId: "a", name: "  Ada   Editor " })).toBe("Ada Editor");
    // Approving again, or rejecting after, is a conflict.
    expect(await w.admin.approve(id, { reviewer: REVIEWER })).toMatchObject({ ok: false, code: "conflict" });
    expect(await w.admin.reject(id, { reviewer: REVIEWER, reason: "late" })).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("refuses to approve an edit with politics, a tragedy, an unknown emoji or a canonical change", async () => {
    const id = insertDraft(w.db, draft);
    const edits = [
      { ...draft, triggers: { en: ["vote for spooky"] } },
      { ...draft, context: { en: "After the earthquake" } },
      { ...draft, emoji: [{ hexcode: "1F9FF", weight: 0.8 }] },
      { ...draft, regions: ["*"], triggers: { en: ["zxqv"] } },
    ];
    for (const edit of edits) {
      const result = await w.admin.approve(id, { reviewer: REVIEWER, record: edit });
      expect(result).toMatchObject({ ok: false, code: "invalid" });
      expect(result.ok ? [] : result.issues).not.toEqual([]);
    }
    expect((await w.admin.overview({})).live).toEqual([]);
  });

  it("rejects with a reason; a reason is required", async () => {
    const id = insertDraft(w.db, draft);
    expect(await w.admin.reject(id, { reviewer: REVIEWER, reason: "  " })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const result = await w.admin.reject(id, { reviewer: REVIEWER, reason: "too narrow" });
    expect(result).toMatchObject({
      ok: true,
      value: { proposal: { status: "rejected", reason: "too narrow" } },
    });
    expect(await w.admin.proposal("nope")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("saves edits to a draft but keeps its provenance, and refuses a deployed id", async () => {
    const id = insertDraft(w.db, draft);
    const edited = {
      ...draft,
      source: "editorial" as const,
      createdBy: "me",
      triggers: { en: ["spooky season"] },
    };
    const result = await w.admin.update(id, edited, REVIEWER);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.proposal.record).toMatchObject({
      triggers: { en: ["spooky season"] },
      source: "ai-proposed",
      createdBy: draft.createdBy,
      status: "draft",
    });
    expect(await w.admin.update(id, { ...draft, id: "goat-football" }, REVIEWER)).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("retires a live entry and exports the approved ones in the git format", async () => {
    await w.admin.approve(insertDraft(w.db, draft), { reviewer: REVIEWER });
    const other = record({ ...draft, id: "boo-week", triggers: { en: ["boo week"] }, reviewedBy: undefined });
    await w.admin.approve(insertDraft(w.db, other), { reviewer: REVIEWER });
    expect(await w.admin.retire("boo-week", { reviewer: REVIEWER, reason: "" })).toMatchObject({ ok: false });
    expect(await w.admin.retire("boo-week", { reviewer: REVIEWER, reason: "duplicate" })).toMatchObject({
      ok: true,
      value: { live: { status: "retired" } },
    });
    const exported = await w.admin.exportLive({ markExported: true });
    expect(exported).toMatchObject({ format: "emojisense-culture-live-export", formatVersion: 1 });
    expect(exported.entries.map((e) => [e.id, e.status, e.reviewedBy])).toEqual([
      ["spooky-season", "approved", "Ada Editor"],
    ]);
    expect((await w.admin.overview({})).live.find((l) => l.id === "spooky-season")?.exportedAt).toBe(NOW);
  });
});

describe("publishing approved live entries", () => {
  let w: CultureWorld;
  const live = record({
    id: "spooky-season",
    status: "draft",
    kind: "event",
    when: { from: "2026-10-15", to: "2026-11-03" },
    context: { en: "The weeks before Halloween" },
    triggers: { en: ["spooky season"] },
    emoji: [{ hexcode: "1F383", weight: 0.7 }],
    source: "ai-proposed",
    reviewedBy: undefined,
  });

  async function approveLive(entry = live) {
    const result = await w.admin.approve(insertDraft(w.db, entry), { reviewer: REVIEWER });
    if (!result.ok) throw new Error(result.message);
  }

  async function get(path: string, init: RequestInit = {}) {
    const route = createCultureRoute({
      packVersion: PACK_VERSION,
      override: createCultureOverride({ packVersion: PACK_VERSION }),
    });
    const url = new URL(`https://api.test${path}`);
    const cache = memoryCache();
    const waits: Promise<unknown>[] = [];
    const response = await route(
      new Request(url, init),
      url,
      w.env,
      { waitUntil: (p) => waits.push(p) },
      cache,
    );
    await Promise.all(waits);
    return response;
  }

  beforeEach(() => {
    w = world();
  });

  it("merges live entries into the deployed files and serves the build from R2", async () => {
    await approveLive();
    const report = await runCulturePublish(w.env, w.runtime, { now: NOW, reason: "manual" });
    expect(report).toMatchObject({
      status: "published",
      state: { liveEntries: ["spooky-season"], skipped: [] },
    });

    const response = await get(`/v1/culture/${PACK_VERSION}/culture.en.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const culture: unknown = await response.json();
    assertCulture(culture);
    expect(culture).toMatchObject({
      format: "emojisense-culture",
      formatVersion: 1,
      packVersion: PACK_VERSION,
    });
    // Events first, then lasting entries: the file order of a deploy.
    expect(culture.entries.map((e) => e.id)).toEqual(["spooky-season", "goat-football"]);
    expect(culture.until).toBe("2027-10-15");

    const index = (await (await get(`/v1/culture/${PACK_VERSION}/index.json`)).json()) as {
      locales: Record<string, { gzipBytes: number }>;
    };
    expect(index).toMatchObject({
      build: report.state?.build,
      live: ["spooky-season"],
      locales: { en: { entries: 2 } },
    });
    expect(index.locales.en?.gzipBytes).toBeLessThanOrEqual(CULTURE_LIVE_GZIP_BUDGET);
    expect(CULTURE_LIVE_GZIP_BUDGET).toBe(6 * 1024);

    const etag = response.headers.get("ETag");
    expect(
      (await get(`/v1/culture/${PACK_VERSION}/culture.en.json`, { headers: { "If-None-Match": etag ?? "" } }))
        .status,
    ).toBe(304);
  });

  it("serves the deployed files without a build, after a deploy, and for other pack versions", async () => {
    const assetBody = (await get(`/v1/culture/${PACK_VERSION}/culture.en.json`)).headers.get("Cache-Control");
    expect(assetBody).toBe("public, max-age=3600");
    expect(w.assets.urls.at(-1)).toBe(`https://assets.local/v1/culture/${PACK_VERSION}/culture.en.json`);

    await approveLive();
    await runCulturePublish(w.env, w.runtime, { now: NOW, reason: "manual" });
    const published = (await (await get(`/v1/culture/${PACK_VERSION}/culture.en.json`)).json()) as Culture;
    expect(published.entries).toHaveLength(2);

    // A deploy ships new files: the old build is not served any more.
    for (const [path, body] of deployedFiles([record()], "2026-10-20")) w.assets.files.set(path, body);
    const deployed = (await (await get(`/v1/culture/${PACK_VERSION}/culture.en.json`)).json()) as Culture;
    expect(deployed.entries.map((e) => e.id)).toEqual(["goat-football"]);
    expect(deployed.from).toBe("2026-10-20");

    expect((await get("/v1/culture/0.0.1/culture.en.json")).status).toBe(404);
    expect((await get(`/v1/culture/${PACK_VERSION}/culture.xx.json`)).status).toBe(404);
    expect((await get(`/v1/culture/${PACK_VERSION}/culture.en.json`, { method: "POST" })).status).toBe(405);
  });

  it("publishes once per change: unchanged, then cleared when nothing is live, old builds pruned", async () => {
    await approveLive();
    const first = await runCulturePublish(w.env, w.runtime, { now: NOW, reason: "manual" });
    expect((await runCulturePublish(w.env, w.runtime, { now: NOW + 1, reason: "nightly" })).status).toBe(
      "unchanged",
    );
    await w.admin.retire("spooky-season", { reviewer: REVIEWER, reason: "over" });
    const cleared = await runCulturePublish(w.env, w.runtime, { now: NOW + 2, reason: "manual" });
    expect(cleared).toMatchObject({ status: "cleared", state: { build: null } });
    // The previous build stays one more publish for isolates that still hold the old pointer.
    expect(w.r2.keys(`culture/${PACK_VERSION}/${first.state?.build}/`)).not.toEqual([]);
    expect((await get(`/v1/culture/${PACK_VERSION}/culture.en.json`)).headers.get("ETag")).toBe('"asset"');
    await runCulturePublish(w.env, w.runtime, { now: NOW + 3, reason: "manual" });
    expect(w.r2.keys(`culture/${PACK_VERSION}/${first.state?.build}/`)).toEqual([]);
  });

  it("leaves out a live entry that fails the checks now, and one that git already has", async () => {
    await approveLive();
    // Approved earlier, then the exclusions grew (a deploy): it is skipped, not served.
    w.db.prepare("UPDATE culture_entries_live SET record = ? WHERE id = 'spooky-season'").run(
      JSON.stringify({
        ...live,
        status: "approved",
        reviewedBy: "x",
        triggers: { en: ["spooky election"] },
      }),
    );
    w.db.exec(`INSERT INTO culture_entries_live (id, status, record, approved_at, updated_at, reviewer_name)
      VALUES ('goat-football', 'approved', '${JSON.stringify(record()).replaceAll("'", "''")}', 0, 0, 'x')`);
    const report = await runCulturePublish(w.env, w.runtime, { now: NOW, reason: "manual" });
    expect(report.status).toBe("cleared");
    expect(report.state?.skipped.map((s) => s.id).sort()).toEqual(["goat-football", "spooky-season"]);
  });

  it("syncs after an approval or a deploy, and does nothing otherwise", async () => {
    expect(await runCultureSync(w.env, w.runtime, { now: NOW })).toMatchObject({ status: "unchanged" });
    await approveLive();
    expect((await runCultureSync(w.env, w.runtime, { now: NOW })).status).toBe("published");
    expect((await runCultureSync(w.env, w.runtime, { now: NOW + 1 })).status).toBe("unchanged");
    expect((await w.admin.overview({})).publishPending).toBe(false);
    for (const [path, body] of deployedFiles([record()], "2026-10-20")) w.assets.files.set(path, body);
    expect((await w.admin.overview({})).publishPending).toBe(true);
    const report = await runCultureSync(w.env, w.runtime, { now: NOW + 2 });
    expect(report).toMatchObject({ status: "published", state: { reason: "sync" } });
    const pointer = await readCulturePointer(w.r2.bucket, PACK_VERSION);
    expect(pointer?.liveEntries).toEqual(["spooky-season"]);
  });

  it("runs from the culture crons; the nightly one publishes even when proposals are off", async () => {
    await approveLive();
    w.env.CULTURE_CRON_ENABLED = "false";
    await runScheduled({ cron: CULTURE_NIGHTLY_CRON, scheduledTime: NOW }, w.env, catalog, w.runtime);
    expect((await readCulturePointer(w.r2.bucket, PACK_VERSION))?.reason).toBe("nightly");
    await runScheduled({ cron: CULTURE_SYNC_CRON, scheduledTime: NOW }, w.env, catalog, w.runtime);
    expect((await readCulturePointer(w.r2.bucket, PACK_VERSION))?.reason).toBe("nightly");
  });

  it("skips without the bucket or the deployed files", async () => {
    const { SHARDS: _, ...noBucket } = w.env;
    expect(await runCulturePublish(noBucket, w.runtime, { now: NOW, reason: "manual" })).toMatchObject({
      status: "skipped",
      reason: "no bucket",
    });
    w.assets.files.clear();
    expect(await runCulturePublish(w.env, w.runtime, { now: NOW, reason: "manual" })).toMatchObject({
      status: "skipped",
      reason: "no deployed culture files",
    });
  });

  it("gives the search API (culture=1) the published build too", async () => {
    const override = createCultureOverride({ packVersion: PACK_VERSION });
    const files = createCultureFiles({
      read: overrideCultureReader(PACK_VERSION, override, assetCultureReader(PACK_VERSION)),
      version: (env) => override.build(env),
      now: () => NOW,
    });
    expect((await files.get("en", w.env))?.entries.map((e) => e.id)).toEqual(["goat-football"]);
    await approveLive();
    await runCulturePublish(w.env, w.runtime, { now: NOW, reason: "manual" });
    // A fresh isolate (the pointer is cached for 5 minutes) sees the build.
    const fresh = createCultureOverride({ packVersion: PACK_VERSION });
    const freshFiles = createCultureFiles({
      read: overrideCultureReader(PACK_VERSION, fresh, assetCultureReader(PACK_VERSION)),
      version: (env) => fresh.build(env),
      now: () => NOW,
    });
    expect((await freshFiles.get("en", w.env))?.entries.map((e) => e.id)).toEqual([
      "spooky-season",
      "goat-football",
    ]);
  });
});
