import type { KeyKind } from "./keys.js";
import type { Metric, PlanId } from "./plans.js";

/** Rows of migrations/0001_init.sql. */
export interface AccountRow {
  id: string;
  email: string | null;
  github_id: string | null;
  name: string | null;
  created_at: number;
}

export interface AppRow {
  id: string;
  account_id: string;
  name: string;
  environment: "dev" | "staging" | "prod";
  plan: PlanId;
  created_at: number;
}

export interface ApiKeyRow {
  id: string;
  app_id: string;
  kind: KeyKind;
  prefix: string;
  hash: string;
  /** JSON-encoded string[] */
  allowed_origins: string;
  created_at: number;
  revoked_at: number | null;
}

export interface UsageRow {
  app_id: string;
  period: string;
  metric: Metric;
  count: number;
}

/** Rows of migrations/0002_product.sql. */
export interface QueryDailyRow {
  app_id: string;
  /** "YYYY-MM-DD", UTC (dayOf). */
  day: string;
  /** Normalized query text, ≤ 64 characters. */
  query: string;
  searches: number;
  /** Searches that returned no result. */
  misses: number;
}
