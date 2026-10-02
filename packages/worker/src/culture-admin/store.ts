/**
 * D1 access for culture Phase 2: `culture_proposals` and `culture_entries_live`
 * (packages/platform/migrations/0005_culture.sql). Rows hold the entry JSON as written; callers
 * validate before they write.
 */
import {
  CULTURE_PROPOSAL_STATUSES,
  type CultureEntryRecord,
  type CultureLiveEntry,
  type CultureProposal,
  type CultureProposalEvidence,
  type CultureProposalStatus,
  type CultureReviewer,
  randomId,
} from "@emojisense/platform";
import type { D1Like } from "../store.ts";

interface ProposalRow {
  id: string;
  entry_id: string;
  status: CultureProposalStatus;
  record: string;
  evidence: string;
  created_at: number;
  updated_at: number;
  reviewer_name: string | null;
  reviewed_at: number | null;
  reason: string | null;
}

interface LiveRow {
  id: string;
  status: "approved" | "retired";
  record: string;
  proposal_id: string | null;
  approved_at: number;
  updated_at: number;
  reviewer_name: string;
  reason: string | null;
  exported_at: number | null;
}

const toProposal = (row: ProposalRow): CultureProposal => ({
  id: row.id,
  entryId: row.entry_id,
  status: row.status,
  record: JSON.parse(row.record) as CultureEntryRecord,
  evidence: JSON.parse(row.evidence) as CultureProposalEvidence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  reviewedAt: row.reviewed_at,
  reviewerName: row.reviewer_name,
  reason: row.reason,
});

const toLive = (row: LiveRow): CultureLiveEntry => ({
  id: row.id,
  status: row.status,
  record: JSON.parse(row.record) as CultureEntryRecord,
  proposalId: row.proposal_id,
  approvedAt: row.approved_at,
  updatedAt: row.updated_at,
  reviewerName: row.reviewer_name,
  reason: row.reason,
  exportedAt: row.exported_at,
});

export function createCultureStore(db: D1Like) {
  return {
    async listProposals(
      status: CultureProposalStatus | undefined,
      limit: number,
    ): Promise<CultureProposal[]> {
      const rows = status
        ? await db
            .prepare("SELECT * FROM culture_proposals WHERE status = ? ORDER BY created_at DESC, id LIMIT ?")
            .bind(status, limit)
            .all<ProposalRow>()
        : await db
            .prepare("SELECT * FROM culture_proposals ORDER BY created_at DESC, id LIMIT ?")
            .bind(limit)
            .all<ProposalRow>();
      return rows.results.map(toProposal);
    },

    async countProposals(): Promise<Record<CultureProposalStatus, number>> {
      const { results } = await db
        .prepare("SELECT status, COUNT(*) AS n FROM culture_proposals GROUP BY status")
        .all<{ status: CultureProposalStatus; n: number }>();
      const counts = Object.fromEntries(CULTURE_PROPOSAL_STATUSES.map((s) => [s, 0])) as Record<
        CultureProposalStatus,
        number
      >;
      for (const row of results) counts[row.status] = Number(row.n);
      return counts;
    },

    async getProposal(id: string): Promise<CultureProposal | undefined> {
      const row = await db
        .prepare("SELECT * FROM culture_proposals WHERE id = ?")
        .bind(id)
        .first<ProposalRow>();
      return row ? toProposal(row) : undefined;
    },

    /** Entry ids and records of every proposal, whatever its status (dedupe). */
    async proposalRecords(): Promise<CultureEntryRecord[]> {
      const { results } = await db.prepare("SELECT record FROM culture_proposals").all<{ record: string }>();
      return results.map((r) => JSON.parse(r.record) as CultureEntryRecord);
    },

    /** Inserts a draft; false when a proposal with the same entry id exists. */
    async insertProposal(
      record: CultureEntryRecord,
      evidence: CultureProposalEvidence,
      now: number,
    ): Promise<CultureProposal | undefined> {
      const id = randomId();
      const { meta } = await db
        .prepare(
          `INSERT INTO culture_proposals (id, entry_id, status, record, evidence, created_at, updated_at)
           VALUES (?, ?, 'draft', ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(id, record.id, JSON.stringify(record), JSON.stringify(evidence), now, now)
        .run();
      return meta.changes > 0 ? this.getProposal(id) : undefined;
    },

    /** Saves an edited draft. The entry id may change only to one no other proposal has. */
    async updateDraft(id: string, record: CultureEntryRecord, now: number): Promise<boolean> {
      const { meta } = await db
        .prepare(
          `UPDATE OR IGNORE culture_proposals SET record = ?, entry_id = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .bind(JSON.stringify(record), record.id, now, id)
        .run();
      return meta.changes > 0;
    },

    /**
     * Approves a draft and makes its entry live, in one transaction. False when the proposal is
     * no longer a draft or a live entry already has the id.
     */
    async approve(
      proposalId: string,
      record: CultureEntryRecord,
      reviewer: CultureReviewer,
      reason: string | null,
      now: number,
    ): Promise<boolean> {
      const results = (await db.batch([
        db
          .prepare(
            `UPDATE culture_proposals SET status = 'approved', record = ?, entry_id = ?, updated_at = ?,
               reviewer_account_id = ?, reviewer_name = ?, reviewed_at = ?, reason = ?
             WHERE id = ? AND status = 'draft'
               AND NOT EXISTS (SELECT 1 FROM culture_entries_live WHERE id = ?)
             RETURNING id`,
          )
          .bind(
            JSON.stringify(record),
            record.id,
            now,
            reviewer.accountId,
            reviewer.name,
            now,
            reason,
            proposalId,
            record.id,
          ),
        db
          .prepare(
            `INSERT INTO culture_entries_live
               (id, status, record, proposal_id, approved_at, updated_at, reviewer_account_id, reviewer_name, reason)
             SELECT ?, 'approved', ?, id, ?, ?, ?, ?, ? FROM culture_proposals
             WHERE id = ? AND status = 'approved' AND reviewed_at = ?
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            record.id,
            JSON.stringify(record),
            now,
            now,
            reviewer.accountId,
            reviewer.name,
            reason,
            proposalId,
            now,
          ),
      ])) as { results: unknown[] }[];
      return (results[0]?.results.length ?? 0) > 0;
    },

    async reject(
      proposalId: string,
      reviewer: CultureReviewer,
      reason: string,
      now: number,
    ): Promise<boolean> {
      const { meta } = await db
        .prepare(
          `UPDATE culture_proposals SET status = 'rejected', updated_at = ?, reviewer_account_id = ?,
             reviewer_name = ?, reviewed_at = ?, reason = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .bind(now, reviewer.accountId, reviewer.name, now, reason, proposalId)
        .run();
      return meta.changes > 0;
    },

    async listLive(): Promise<CultureLiveEntry[]> {
      const { results } = await db
        .prepare("SELECT * FROM culture_entries_live ORDER BY approved_at DESC, id")
        .all<LiveRow>();
      return results.map(toLive);
    },

    async getLive(id: string): Promise<CultureLiveEntry | undefined> {
      const row = await db
        .prepare("SELECT * FROM culture_entries_live WHERE id = ?")
        .bind(id)
        .first<LiveRow>();
      return row ? toLive(row) : undefined;
    },

    /** The entries a publish merges: approved ones, oldest first. */
    async approvedLive(): Promise<CultureLiveEntry[]> {
      const { results } = await db
        .prepare("SELECT * FROM culture_entries_live WHERE status = 'approved' ORDER BY approved_at, id")
        .all<LiveRow>();
      return results.map(toLive);
    },

    async retireLive(id: string, reviewer: CultureReviewer, reason: string, now: number): Promise<boolean> {
      const record = await this.getLive(id);
      if (record?.status !== "approved") return false;
      const retired: CultureEntryRecord = { ...record.record, status: "retired", reviewedBy: reviewer.name };
      const { meta } = await db
        .prepare(
          `UPDATE culture_entries_live SET status = 'retired', record = ?, updated_at = ?,
             reviewer_account_id = ?, reviewer_name = ?, reason = ?
           WHERE id = ? AND status = 'approved'`,
        )
        .bind(JSON.stringify(retired), now, reviewer.accountId, reviewer.name, reason, id)
        .run();
      return meta.changes > 0;
    },

    async markExported(ids: readonly string[], now: number): Promise<void> {
      if (ids.length === 0) return;
      await db.batch(
        ids.map((id) =>
          db.prepare("UPDATE culture_entries_live SET exported_at = ? WHERE id = ?").bind(now, id),
        ),
      );
    },
  };
}

export type CultureStore = ReturnType<typeof createCultureStore>;
