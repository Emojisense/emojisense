/**
 * Mock mode for the internal Culture page: a few proposals from the nightly job, live entries and
 * a publish state. Previews are computed from a small canonical table, like the API Worker does
 * with the real packs: the entry's emoji go right after the canonical top answer.
 */
import type {
  CultureAdminOverview,
  CultureEntryRecord,
  CultureIssue,
  CultureLiveEntry,
  CulturePreview,
  CulturePreviewResult,
  CultureProposal,
  CultureProposalStatus,
  CulturePublishState,
} from "@emojisense/platform";
import { glyphOf, PACK_LOCALES } from "../lib/cultureForm";
import type { MockRequest, MockResponse } from "./handlers";

const HOUR = 3_600_000;
const NOW = Date.now();

/** Canonical answers (hexcodes) of the triggers the fixtures use. */
const CANONICAL: Record<string, string[]> = {
  "spooky season": ["1F47B", "1F383", "1F578-FE0F"],
  spooky: ["1F47B", "1F480", "1F383"],
  "cup final": ["1F3C6", "26BD", "1F947"],
  "final match": ["1F3C1", "1F3C6"],
  "copa final": ["1F3C6", "26BD"],
  diwali: ["1FA94", "1F6D5", "1FAB7", "1F386"],
  "happy diwali": ["1FA94", "1F6D5", "1FAB7"],
  "touch grass": ["1F33F", "1F331"],
  "pumpkin spice": ["1F383", "2615"],
  "pumpkin spice latte": ["2615", "1F383"],
};

const record = (overrides: Partial<CultureEntryRecord>): CultureEntryRecord => ({
  id: "x",
  status: "draft",
  kind: "event",
  context: { en: "" },
  when: null,
  regions: ["*"],
  locales: ["en"],
  triggers: {},
  emoji: [],
  source: "ai-proposed",
  createdBy: "workers-ai:@cf/google/gemma-4-26b-a4b-it prompt:propose.v2 job:nightly",
  createdAt: "2026-10-02",
  ...overrides,
});

const evidenceFor = (origin: "trend" | "calendar", rest: Partial<CultureProposal["evidence"]> = {}) => ({
  origin,
  model: "@cf/google/gemma-4-26b-a4b-it",
  prompt: "propose.v2",
  gate: { queries: 217, triggers: 2 },
  droppedTriggers: [],
  warnings: [],
  ...rest,
});

const proposals: CultureProposal[] = [
  {
    id: "prop_spooky",
    entryId: "spooky-season-2026",
    status: "draft",
    record: record({
      id: "spooky-season-2026",
      kind: "event",
      when: { from: "2026-10-02", to: "2026-10-31" },
      regions: ["GB", "US"],
      context: { en: "The weeks before Halloween" },
      triggers: { en: ["spooky season", "spooky"] },
      emoji: [
        { hexcode: "1F383", weight: 0.8 },
        { hexcode: "1F578-FE0F", weight: 0.55 },
        { hexcode: "1F47B", weight: 0.5 },
      ],
    }),
    evidence: evidenceFor("trend", {
      trends: [
        { day: "2026-10-02", locale: "en", country: "US", query: "spooky season", score: 6.4, searches: 412 },
        { day: "2026-10-02", locale: "en", country: "GB", query: "spooky season", score: 4.1, searches: 96 },
      ],
      droppedTriggers: [{ locale: "en", trigger: "halloween", owner: "halloween" }],
    }),
    createdAt: NOW - 5 * HOUR,
    updatedAt: NOW - 5 * HOUR,
    reviewedAt: null,
    reviewerName: null,
    reason: null,
  },
  {
    id: "prop_cup",
    entryId: "cup-final-2026",
    status: "draft",
    record: record({
      id: "cup-final-2026",
      source: "calendar",
      kind: "event",
      featured: true,
      when: { from: "2026-10-18", to: "2026-10-25" },
      locales: ["en", "es"],
      context: { en: "The football cup final", es: "La final de la copa de fútbol" },
      triggers: { en: ["cup final", "final match"], es: ["copa final"] },
      emoji: [
        { hexcode: "1F3C6", weight: 0.8 },
        { hexcode: "26BD", weight: 0.65 },
        { hexcode: "1F3DF-FE0F", weight: 0.4 },
      ],
    }),
    evidence: evidenceFor("calendar", {
      source: {
        id: "cup-final",
        title: "Cup final",
        category: "sports event",
        days: "2026-10-25 → 2026-10-25",
        basis: "listed by the organiser",
      },
    }),
    createdAt: NOW - 5 * HOUR,
    updatedAt: NOW - 5 * HOUR,
    reviewedAt: null,
    reviewerName: null,
    reason: null,
  },
  {
    id: "prop_psl",
    entryId: "pumpkin-spice",
    status: "draft",
    record: record({
      id: "pumpkin-spice",
      kind: "lasting",
      context: { en: "Autumn's spiced coffee drinks" },
      triggers: { en: ["pumpkin spice", "pumpkin spice latte"] },
      emoji: [
        { hexcode: "2615", weight: 0.7 },
        { hexcode: "1F342", weight: 0.6 },
      ],
    }),
    evidence: evidenceFor("trend", {
      trends: [
        { day: "2026-10-02", locale: "en", country: "*", query: "pumpkin spice", score: 3.2, searches: 188 },
      ],
    }),
    createdAt: NOW - 29 * HOUR,
    updatedAt: NOW - 29 * HOUR,
    reviewedAt: null,
    reviewerName: null,
    reason: null,
  },
  {
    id: "prop_grass",
    entryId: "touch-grass-season",
    status: "rejected",
    record: record({
      id: "touch-grass-season",
      kind: "lasting",
      context: { en: "Go outside" },
      triggers: { en: ["touch grass"] },
      emoji: [{ hexcode: "1F33F", weight: 0.7 }],
    }),
    evidence: evidenceFor("trend", {
      trends: [
        { day: "2026-10-01", locale: "en", country: "US", query: "touch grass", score: 2.4, searches: 61 },
      ],
    }),
    createdAt: NOW - 52 * HOUR,
    updatedAt: NOW - 30 * HOUR,
    reviewedAt: NOW - 30 * HOUR,
    reviewerName: "Ada",
    reason: "The git entry touch-grass already covers it.",
  },
];

const live: CultureLiveEntry[] = [
  {
    id: "diwali-2026-live",
    status: "approved",
    record: record({
      id: "diwali-2026-live",
      status: "approved",
      source: "calendar",
      kind: "event",
      featured: true,
      when: { from: "2026-11-01", to: "2026-11-11" },
      context: { en: "Diwali, the festival of lights" },
      triggers: { en: ["diwali", "happy diwali"] },
      emoji: [
        { hexcode: "1FA94", weight: 0.9 },
        { hexcode: "1F386", weight: 0.6 },
      ],
      reviewedBy: "Ada",
    }),
    proposalId: null,
    approvedAt: NOW - 26 * HOUR,
    updatedAt: NOW - 26 * HOUR,
    reviewerName: "Ada",
    reason: "Checked the date with the calendar source.",
    exportedAt: null,
  },
];

let publish: CulturePublishState = {
  build: "4f1c9a0b7d2e6531",
  base: "a1b2c3d4e5f60718",
  publishedAt: NOW - 3 * HOUR,
  reason: "sync",
  liveEntries: ["diwali-2026-live"],
  skipped: [],
};
let pending = false;

function result(hexcode: string, culture: boolean): CulturePreviewResult {
  return { emoji: glyphOf(hexcode), hexcode, culture };
}

/** Validation the mock can do on its own: the API Worker runs the real rules. */
function issuesOf(entry: CultureEntryRecord): CultureIssue[] {
  const issues: CultureIssue[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id))
    issues.push({ level: "error", message: `id "${entry.id}" must be lowercase words joined by "-"` });
  if (entry.emoji.length === 0) issues.push({ level: "error", message: "emoji: 1–6 items" });
  for (const e of entry.emoji) {
    if (!glyphOf(e.hexcode))
      issues.push({ level: "error", message: `emoji ${e.hexcode} is not a base emoji of the catalog` });
    if (!(e.weight > 0 && e.weight <= 1))
      issues.push({ level: "error", message: `emoji ${e.hexcode}: weight must be in (0, 1]` });
  }
  const text = [...Object.values(entry.context), ...Object.values(entry.triggers).flat()]
    .join(" ")
    .toLowerCase();
  if (/\belection|\bearthquake/.test(text))
    issues.push({ level: "error", message: 'contains an excluded phrase: "election" (political)' });
  if (Object.values(entry.triggers).flat().length === 0)
    issues.push({ level: "error", message: "no triggers: the entry would never apply" });
  return issues;
}

function previewOf(entry: CultureEntryRecord): CulturePreview {
  const locales = entry.locales.includes("*") ? [...PACK_LOCALES] : entry.locales;
  const scoped = !entry.regions.includes("*");
  const issues = issuesOf(entry);
  return {
    id: entry.id,
    issues,
    gate: { queries: 217, triggers: Object.values(entry.triggers).flat().length, failed: false },
    locales: locales.map((locale) => ({
      locale,
      context: entry.context[locale] ?? null,
      triggers: (entry.triggers[locale] ?? []).map((trigger) => {
        const canonical = CANONICAL[trigger] ?? [];
        const added = entry.emoji.map((e) => e.hexcode).filter((h) => glyphOf(h) && h !== canonical[0]);
        const boosted =
          canonical.length === 0
            ? added.map((h) => result(h, true))
            : [
                result(canonical[0] as string, false),
                ...added.map((h) => result(h, true)),
                ...canonical
                  .slice(1)
                  .filter((h) => !added.includes(h))
                  .map((h) => result(h, false)),
              ];
        return {
          trigger,
          canonical: canonical.map((h) => result(h, false)),
          boosted: boosted.slice(0, 8),
          added: added.length,
          ...(canonical.length === 0 ? { note: "no-canonical" as const } : {}),
          ...(scoped
            ? {
                regions: [
                  { region: entry.regions[0] ?? "GB", inScope: true, results: boosted.slice(0, 8) },
                  { region: "DE", inScope: false, results: canonical.map((h) => result(h, false)) },
                ],
              }
            : {}),
        };
      }),
    })),
  };
}

const ok = (body: unknown, status = 200): MockResponse => ({ status, body });
const fail = (status: number, code: string, message: string): MockResponse => ({
  status,
  body: { error: { code, message } },
});

function overview(status?: CultureProposalStatus): CultureAdminOverview {
  const counts = { draft: 0, approved: 0, rejected: 0 };
  for (const p of proposals) counts[p.status]++;
  return {
    proposals: proposals.filter((p) => !status || p.status === status),
    counts,
    live,
    publish,
    publishPending: pending,
  };
}

const find = (id: string | undefined) => proposals.find((p) => p.id === id);
const asRecord = (value: unknown) => value as CultureEntryRecord;

type Handler = (db: unknown, request: MockRequest) => MockResponse;

export const CULTURE_ROUTES: [method: string, pattern: RegExp, handler: Handler][] = [
  ["GET", /^\/api\/admin$/, () => ok({ admin: true, culture: true })],
  [
    "GET",
    /^\/api\/admin\/culture$/,
    (_, { url }) =>
      ok(overview((url.searchParams.get("status") as CultureProposalStatus | null) ?? undefined)),
  ],
  ["POST", /^\/api\/admin\/culture\/preview$/, (_, { json }) => ok(previewOf(asRecord(json.record)))],
  [
    "POST",
    /^\/api\/admin\/culture\/publish$/,
    () => {
      publish = {
        ...publish,
        build: Math.random().toString(16).slice(2, 18).padEnd(16, "0"),
        publishedAt: Date.now(),
        reason: "manual",
        liveEntries: live.filter((l) => l.status === "approved").map((l) => l.id),
      };
      pending = false;
      return ok({ status: "published", state: publish });
    },
  ],
  [
    "POST",
    /^\/api\/admin\/culture\/export$/,
    () =>
      ok({
        format: "emojisense-culture-live-export",
        formatVersion: 1,
        exportedAt: Date.now(),
        entries: live.filter((l) => l.status === "approved").map((l) => l.record),
      }),
  ],
  [
    "GET",
    /^\/api\/admin\/culture\/proposals\/([^/]+)$/,
    (_, { params }) => {
      const proposal = find(params[0]);
      return proposal
        ? ok({ proposal, preview: previewOf(proposal.record) })
        : fail(404, "not_found", "No such proposal.");
    },
  ],
  [
    "PATCH",
    /^\/api\/admin\/culture\/proposals\/([^/]+)$/,
    (_, { params, json }) => {
      const proposal = find(params[0]);
      if (!proposal) return fail(404, "not_found", "No such proposal.");
      proposal.record = { ...asRecord(json.record), status: "draft" };
      proposal.entryId = proposal.record.id;
      proposal.updatedAt = Date.now();
      return ok({ proposal, preview: previewOf(proposal.record) });
    },
  ],
  [
    "POST",
    /^\/api\/admin\/culture\/proposals\/([^/]+)\/approve$/,
    (_, { params, json }) => {
      const proposal = find(params[0]);
      if (!proposal) return fail(404, "not_found", "No such proposal.");
      if (proposal.status !== "draft")
        return fail(409, "conflict", `The proposal is already ${proposal.status}.`);
      const entry = {
        ...(json.record ? asRecord(json.record) : proposal.record),
        status: "approved" as const,
        reviewedBy: "Ada",
      };
      if (issuesOf(entry).some((i) => i.level === "error"))
        return fail(422, "invalid", "Fix the errors before you approve.");
      Object.assign(proposal, {
        status: "approved",
        record: entry,
        reviewedAt: Date.now(),
        reviewerName: "Ada",
        reason: typeof json.reason === "string" ? json.reason : null,
      });
      const added: CultureLiveEntry = {
        id: entry.id,
        status: "approved",
        record: entry,
        proposalId: proposal.id,
        approvedAt: Date.now(),
        updatedAt: Date.now(),
        reviewerName: "Ada",
        reason: proposal.reason,
        exportedAt: null,
      };
      live.unshift(added);
      pending = true;
      return ok({ proposal, live: added });
    },
  ],
  [
    "POST",
    /^\/api\/admin\/culture\/proposals\/([^/]+)\/reject$/,
    (_, { params, json }) => {
      const proposal = find(params[0]);
      if (!proposal) return fail(404, "not_found", "No such proposal.");
      const reason = typeof json.reason === "string" ? json.reason.trim() : "";
      if (!reason) return fail(422, "invalid", "Say why you reject it.");
      Object.assign(proposal, { status: "rejected", reviewedAt: Date.now(), reviewerName: "Ada", reason });
      return ok({ proposal });
    },
  ],
  [
    "POST",
    /^\/api\/admin\/culture\/live\/([^/]+)\/retire$/,
    (_, { params, json }) => {
      const entry = live.find((l) => l.id === params[0]);
      if (!entry) return fail(404, "not_found", "No such live entry.");
      Object.assign(entry, { status: "retired", reason: String(json.reason ?? ""), updatedAt: Date.now() });
      pending = true;
      return ok({ live: entry });
    },
  ],
];
