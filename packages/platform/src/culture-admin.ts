/**
 * The culture admin contract (culture Phase 2) between the dashboard and the API Worker. The API
 * Worker owns the culture tables (migrations/0005_culture.sql), the validation, the previews and
 * the R2 publishing; the dashboard checks that the caller is an admin (ADMIN_EMAILS) and calls it
 * through a service binding (RPC entrypoint `CultureAdmin`), which is not reachable from the
 * internet. Times are Unix epoch milliseconds.
 */

/** A culture entry (packages/data/culture/schema.json): the same shape as `CultureRecord` in @emojisense/data. */
export interface CultureEntryRecord {
  id: string;
  status: "draft" | "approved" | "retired";
  kind: "lasting" | "seasonal" | "event" | "regional";
  context: Record<string, string>;
  when: { from: string; to: string; recurs?: "yearly" } | null;
  regions: string[];
  exceptRegions?: string[];
  locales: string[];
  triggers: Record<string, string[]>;
  emoji: { hexcode: string; weight: number }[];
  outranks?: string[];
  featured?: boolean;
  source: "editorial" | "ai-proposed" | "calendar";
  createdBy: string;
  reviewedBy?: string;
  createdAt: string;
}

export const CULTURE_PROPOSAL_STATUSES = ["draft", "approved", "rejected"] as const;
export type CultureProposalStatus = (typeof CULTURE_PROPOSAL_STATUSES)[number];

/** A search phrase that rose in one locale and country (D1 `trends_daily`, k-anonymous). */
export interface CultureTrendEvidence {
  day: string;
  locale: string;
  /** ISO 3166-1 alpha-2, or "*" for the whole locale. */
  country: string;
  query: string;
  /** Recent searches per day over the baseline (higher = rising faster). */
  score: number;
  /** Searches in the trend window, over all accounts. */
  searches: number;
}

export interface CultureProposalEvidence {
  origin: "trend" | "calendar";
  /** origin "trend": the rows that made the phrase a candidate. */
  trends?: CultureTrendEvidence[];
  /** origin "calendar": the source item (packages/data/culture/sources). */
  source?: { id: string; title: string; category: string; days: string; basis: string };
  model: string;
  prompt: string;
  /** What the gate checked before the draft was stored. */
  gate: { queries: number; triggers: number };
  /** Triggers the model wrote that another entry already uses (left out of the draft). */
  droppedTriggers: { locale: string; trigger: string; owner: string }[];
  /** Validation warnings at proposal time. */
  warnings: string[];
}

export interface CultureReviewer {
  accountId: string;
  /** Shown in the entry as `reviewedBy`; a display name, never an email address. */
  name: string;
}

export interface CultureProposal {
  id: string;
  entryId: string;
  status: CultureProposalStatus;
  record: CultureEntryRecord;
  evidence: CultureProposalEvidence;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  reviewerName: string | null;
  reason: string | null;
}

export interface CultureLiveEntry {
  id: string;
  status: "approved" | "retired";
  record: CultureEntryRecord;
  proposalId: string | null;
  approvedAt: number;
  updatedAt: number;
  reviewerName: string;
  reason: string | null;
  exportedAt: number | null;
}

export interface CultureIssue {
  level: "error" | "warning";
  message: string;
}

export interface CulturePreviewResult {
  emoji: string;
  hexcode: string;
  culture: boolean;
}

export interface CultureTriggerPreview {
  trigger: string;
  canonical: CulturePreviewResult[];
  boosted: CulturePreviewResult[];
  added: number;
  note?: "no-canonical" | "adds-nothing";
  regions?: { region: string; inScope: boolean; results: CulturePreviewResult[] }[];
}

export interface CulturePreview {
  id: string;
  issues: CultureIssue[];
  locales: { locale: string; context: string | null; triggers: CultureTriggerPreview[] }[];
  /** The gate run on this entry alone: blocking findings are also in `issues` as errors. */
  gate: { queries: number; triggers: number; failed: boolean };
}

/** The R2 override the Worker serves at /v1/culture/<packVersion>/… (null: the deployed files). */
export interface CulturePublishState {
  build: string | null;
  /** Hash of the deployed culture index the build was made from; a deploy changes it. */
  base: string;
  publishedAt: number;
  reason: "nightly" | "manual" | "sync";
  /** Live entries in the build, and the ones skipped (invalid now, or already in git). */
  liveEntries: string[];
  skipped: { id: string; reason: string }[];
}

export interface CulturePublishReport {
  status: "published" | "unchanged" | "cleared" | "skipped" | "failed";
  reason?: string;
  state?: CulturePublishState;
}

export interface CultureAdminOverview {
  proposals: CultureProposal[];
  counts: Record<CultureProposalStatus, number>;
  live: CultureLiveEntry[];
  publish: CulturePublishState | null;
  /** True when the deployed files changed since the last publish: approvals wait for a publish. */
  publishPending: boolean;
}

/** The export format of approved live entries: `pnpm --filter @emojisense/data culture:import-live`. */
export interface CultureLiveExport {
  format: "emojisense-culture-live-export";
  formatVersion: 1;
  exportedAt: number;
  entries: CultureEntryRecord[];
}

export type CultureAdminResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** not_found, conflict, invalid, unavailable */
      code: "not_found" | "conflict" | "invalid" | "unavailable";
      message: string;
      issues?: CultureIssue[];
    };

/** The RPC methods of the API Worker's `CultureAdmin` entrypoint. */
export interface CultureAdminRpc {
  overview(query: { status?: CultureProposalStatus; limit?: number }): Promise<CultureAdminOverview>;
  proposal(id: string): Promise<CultureAdminResult<{ proposal: CultureProposal; preview: CulturePreview }>>;
  /** Validation, gate and preview of an edited entry, without saving it. */
  preview(record: CultureEntryRecord): Promise<CulturePreview>;
  /** Saves edits to a draft (it stays a draft). */
  update(
    id: string,
    record: CultureEntryRecord,
    reviewer: CultureReviewer,
  ): Promise<CultureAdminResult<{ proposal: CultureProposal; preview: CulturePreview }>>;
  approve(
    id: string,
    input: { reviewer: CultureReviewer; reason?: string; record?: CultureEntryRecord },
  ): Promise<CultureAdminResult<{ proposal: CultureProposal; live: CultureLiveEntry }>>;
  reject(
    id: string,
    input: { reviewer: CultureReviewer; reason: string },
  ): Promise<CultureAdminResult<{ proposal: CultureProposal }>>;
  /** Takes a live entry out of the next publish. */
  retire(
    id: string,
    input: { reviewer: CultureReviewer; reason: string },
  ): Promise<CultureAdminResult<{ live: CultureLiveEntry }>>;
  publish(): Promise<CulturePublishReport>;
  /** Approved live entries in the git record format; `markExported` stamps them. */
  exportLive(input: { markExported: boolean }): Promise<CultureLiveExport>;
}
