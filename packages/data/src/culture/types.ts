import type { CultureKind, CultureWhen } from "emojisense";

export type RecordStatus = "draft" | "approved" | "retired";
export type RecordSource = "editorial" | "ai-proposed" | "calendar";

/**
 * One editorial association, `culture/entries/<id>.json` (schema: culture/schema.json). The build
 * turns approved records into per-locale culture files (core `Culture`).
 */
export interface CultureRecord {
  id: string;
  status: RecordStatus;
  kind: CultureKind;
  /** Neutral reason per locale: English (for reviewers and the website) and every targeted locale. */
  context: Record<string, string>;
  when: CultureWhen;
  /** ISO 3166-1 alpha-2 codes, or ["*"]. */
  regions: string[];
  /** Pack locales, or ["*"]. */
  locales: string[];
  /** Normalized trigger phrases per targeted locale. Each locale file gets only its own list. */
  triggers: Record<string, string[]>;
  emoji: { hexcode: string; weight: number }[];
  featured?: boolean;
  source: RecordSource;
  createdBy: string;
  reviewedBy?: string;
  createdAt: string;
}

export type IssueLevel = "error" | "warning";

export interface Issue {
  id: string;
  level: IssueLevel;
  message: string;
}
