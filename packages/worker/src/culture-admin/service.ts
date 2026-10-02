/**
 * The culture admin service behind the `CultureAdmin` RPC entrypoint (index.ts). The dashboard
 * calls it through a service binding after it has checked ADMIN_EMAILS; nothing on the public
 * internet reaches it. Every write validates the entry with the bundled catalog and exclusions
 * (the rules of culture:check) and runs the culture gate before it approves.
 */
import type { CultureRecord } from "@emojisense/data/culture-core";
import type {
  CultureAdminOverview,
  CultureAdminResult,
  CultureAdminRpc,
  CultureEntryRecord,
  CultureLiveExport,
  CulturePreview,
  CultureProposal,
  CultureReviewer,
} from "@emojisense/platform";
import type { Env } from "../env.ts";
import { CULTURE_OVERVIEW_LIMIT } from "./config.ts";
import { publishPending, runCulturePublish } from "./publish.ts";
import { type CultureRuntime, previewWithGate } from "./runtime.ts";
import { readCulturePointer, readDeployedCulture } from "./storage.ts";
import { createCultureStore } from "./store.ts";

const MAX_REASON_CHARS = 500;
const MAX_RECORD_BYTES = 32 * 1024;

const fail = (
  code: "not_found" | "conflict" | "invalid" | "unavailable",
  message: string,
  issues?: CulturePreview["issues"],
) => ({ ok: false as const, code, message, ...(issues ? { issues } : {}) });

const cleanReason = (reason: string | undefined) => {
  const text = (reason ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS);
  return text === "" ? null : text;
};

/**
 * The fields an editor may change. Status, provenance and dates come from the stored draft, so
 * an edit cannot claim another source or an earlier review.
 */
function editedRecord(stored: CultureEntryRecord, edit: CultureEntryRecord): CultureEntryRecord {
  return {
    id: edit.id,
    status: stored.status,
    kind: edit.kind,
    context: edit.context,
    when: edit.when,
    regions: edit.regions,
    ...(edit.exceptRegions?.length ? { exceptRegions: edit.exceptRegions } : {}),
    locales: edit.locales,
    triggers: edit.triggers,
    emoji: edit.emoji,
    ...(edit.outranks?.length ? { outranks: edit.outranks } : {}),
    ...(edit.featured ? { featured: true } : {}),
    source: stored.source,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
  };
}

/** A record from the dashboard: JSON-shaped and small. The validator checks the rest. */
function readableRecord(value: unknown): value is CultureEntryRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_RECORD_BYTES;
  } catch {
    return false;
  }
}

export function createCultureAdmin(
  env: Env,
  runtime: CultureRuntime,
  now: () => number = Date.now,
): CultureAdminRpc {
  const db = () => {
    if (!env.DB) throw new Error("culture admin: no database");
    return createCultureStore(env.DB);
  };

  /** Ids a draft may not take: deployed (git) entries, live entries, other proposals. */
  async function idTaken(id: string, proposalId: string): Promise<string | undefined> {
    const store = db();
    const deployed = env.ASSETS ? await readDeployedCulture(env, runtime.packVersion) : undefined;
    for (const file of deployed?.files.values() ?? []) {
      if (file.entries.some((e) => e.id === id)) return "a deployed entry";
    }
    if (await store.getLive(id)) return "a live entry";
    const other = (await store.proposalRecords()).some((r) => r.id === id);
    const own = (await store.getProposal(proposalId))?.entryId === id;
    return other && !own ? "another proposal" : undefined;
  }

  const preview = (record: CultureEntryRecord) => previewWithGate(runtime, env, record as CultureRecord);

  async function withPreview(proposal: CultureProposal) {
    return { proposal, preview: await preview(proposal.record) };
  }

  return {
    async overview({ status, limit }): Promise<CultureAdminOverview> {
      const store = db();
      const pointer = env.SHARDS ? await readCulturePointer(env.SHARDS, runtime.packVersion) : undefined;
      return {
        proposals: await store.listProposals(
          status,
          Math.min(limit ?? CULTURE_OVERVIEW_LIMIT, CULTURE_OVERVIEW_LIMIT),
        ),
        counts: await store.countProposals(),
        live: await store.listLive(),
        publish: pointer
          ? {
              build: pointer.build,
              base: pointer.base,
              publishedAt: pointer.publishedAt,
              reason: pointer.reason,
              liveEntries: pointer.liveEntries,
              skipped: pointer.skipped,
            }
          : null,
        publishPending: await publishPending(env, runtime),
      };
    },

    async proposal(id) {
      const proposal = await db().getProposal(id);
      return proposal
        ? { ok: true, value: await withPreview(proposal) }
        : fail("not_found", "No such proposal.");
    },

    async preview(record) {
      if (!readableRecord(record)) {
        return {
          id: "?",
          issues: [{ level: "error", message: "not an entry" }],
          locales: [],
          gate: { queries: 0, triggers: 0, failed: false },
        };
      }
      return preview(record);
    },

    async update(
      id,
      edit,
      _reviewer,
    ): Promise<CultureAdminResult<{ proposal: CultureProposal; preview: CulturePreview }>> {
      const store = db();
      const stored = await store.getProposal(id);
      if (!stored) return fail("not_found", "No such proposal.");
      if (stored.status !== "draft")
        return fail("conflict", `The proposal is ${stored.status}; only drafts can change.`);
      if (!readableRecord(edit)) return fail("invalid", "The entry is not a valid object.");
      const record = editedRecord(stored.record, edit);
      if (record.id !== stored.entryId) {
        const taken = await idTaken(record.id, id);
        if (taken) return fail("conflict", `The id "${record.id}" is used by ${taken}.`);
      }
      if (!(await store.updateDraft(id, record, now())))
        return fail("conflict", "The proposal changed; reload it.");
      const saved = await store.getProposal(id);
      return saved ? { ok: true, value: await withPreview(saved) } : fail("not_found", "No such proposal.");
    },

    async approve(id, { reviewer, reason, record: edit }) {
      const store = db();
      const stored = await store.getProposal(id);
      if (!stored) return fail("not_found", "No such proposal.");
      if (stored.status !== "draft") return fail("conflict", `The proposal is already ${stored.status}.`);
      if (edit !== undefined && !readableRecord(edit))
        return fail("invalid", "The entry is not a valid object.");
      const draft = edit ? editedRecord(stored.record, edit) : stored.record;
      const editor = { ...reviewer, name: reviewerName(reviewer) };
      const record: CultureEntryRecord = { ...draft, status: "approved", reviewedBy: editor.name };
      const taken = await idTaken(record.id, id);
      if (taken) return fail("conflict", `The id "${record.id}" is used by ${taken}.`);
      const checked = await preview(record);
      const errors = checked.issues.filter((i) => i.level === "error");
      if (errors.length > 0) return fail("invalid", "Fix the errors before you approve.", errors);
      const at = now();
      if (!(await store.approve(id, record, editor, cleanReason(reason), at))) {
        return fail("conflict", "The proposal changed, or a live entry has this id; reload it.");
      }
      const proposal = await store.getProposal(id);
      const live = await store.getLive(record.id);
      if (!proposal || !live) return fail("conflict", "The approval did not complete; reload it.");
      console.log(JSON.stringify({ event: "culture_approved", id: record.id }));
      return { ok: true, value: { proposal, live } };
    },

    async reject(id, { reviewer, reason }) {
      const text = cleanReason(reason);
      if (!text) return fail("invalid", "Say why you reject it: the reason helps the next proposals.");
      const store = db();
      const stored = await store.getProposal(id);
      if (!stored) return fail("not_found", "No such proposal.");
      if (stored.status !== "draft") return fail("conflict", `The proposal is already ${stored.status}.`);
      const editor = { ...reviewer, name: reviewerName(reviewer) };
      if (!(await store.reject(id, editor, text, now())))
        return fail("conflict", "The proposal changed; reload it.");
      const proposal = await store.getProposal(id);
      return proposal ? { ok: true, value: { proposal } } : fail("not_found", "No such proposal.");
    },

    async retire(id, { reviewer, reason }) {
      const text = cleanReason(reason);
      if (!text) return fail("invalid", "Say why the entry is retired.");
      const store = db();
      const live = await store.getLive(id);
      if (!live) return fail("not_found", "No such live entry.");
      if (live.status !== "approved") return fail("conflict", "The entry is already retired.");
      if (!(await store.retireLive(id, { ...reviewer, name: reviewerName(reviewer) }, text, now()))) {
        return fail("conflict", "The entry changed; reload it.");
      }
      const saved = await store.getLive(id);
      return saved ? { ok: true, value: { live: saved } } : fail("not_found", "No such live entry.");
    },

    publish() {
      return runCulturePublish(env, runtime, { now: now(), reason: "manual" });
    },

    async exportLive({ markExported }): Promise<CultureLiveExport> {
      const store = db();
      const live = await store.approvedLive();
      const at = now();
      if (markExported)
        await store.markExported(
          live.map((l) => l.id),
          at,
        );
      return {
        format: "emojisense-culture-live-export",
        formatVersion: 1,
        exportedAt: at,
        entries: live.map((l) => l.record),
      };
    },
  };
}

/** `reviewedBy` of an approved entry: the editor's display name (never an email address). */
export function reviewerName(reviewer: CultureReviewer): string {
  const name = reviewer.name.replace(/\s+/g, " ").trim().slice(0, 80);
  return name.includes("@") ? (name.split("@")[0] ?? "editor") : name || "editor";
}
