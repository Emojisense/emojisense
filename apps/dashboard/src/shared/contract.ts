/**
 * JSON shapes of the dashboard API (docs/API.md, "Dashboard API"). The Worker produces them and
 * the SPA consumes them, so both import from here. Times are Unix epoch milliseconds.
 */
import type { KeyKind, Metric, PlanId } from "@emojisense/platform";

export type Environment = "dev" | "staging" | "prod";
export const ENVIRONMENTS: readonly Environment[] = ["prod", "staging", "dev"];

/** Every dashboard error. A 402 has code "plan_required" and names the lowest plan that has the feature. */
export interface ApiErrorBody {
  error: { code: string; message: string; field?: string; plan?: PlanId };
}

export interface AccountSummary {
  id: string;
  name: string | null;
  email: string | null;
  githubLinked: boolean;
  createdAt: number;
}

/** JSON has no Infinity, so "unlimited" is `null`. */
export interface PlanSummary {
  id: PlanId;
  name: string;
  priceUsdMonthly: number;
  limits: Record<Metric, number | null>;
  maxApps: number | null;
}

export interface MeResponse {
  account: AccountSummary;
  plan: PlanSummary;
  appCount: number;
  /** Plan the account's email is on the waitlist for, if any. */
  waitlistPlan: string | null;
}

export interface AppSummary {
  id: string;
  name: string;
  environment: Environment;
  plan: PlanId;
  createdAt: number;
  activeKeyCount: number;
}

export interface AppsResponse {
  apps: AppSummary[];
}

export interface AppResponse {
  app: AppSummary;
}

export interface KeySummary {
  id: string;
  appId: string;
  kind: KeyKind;
  /** First 12 characters of the key, e.g. "pk_live_AbCd". The full key is never stored. */
  prefix: string;
  allowedOrigins: string[];
  createdAt: number;
  revokedAt: number | null;
}

export interface AppDetailResponse {
  app: AppSummary;
  keys: KeySummary[];
}

export interface KeyResponse {
  key: KeySummary;
}

/** Only the create response carries the full key. */
export interface CreatedKeyResponse {
  key: KeySummary;
  fullKey: string;
}

export type UsageStatus = "ok" | "near_limit" | "over_limit" | "not_included";

export interface MetricUsage {
  metric: Metric;
  used: number;
  /** `null` = unlimited. */
  limit: number | null;
  /** Share of the limit used, 0–100, one decimal, rounded down. */
  percent: number;
  status: UsageStatus;
}

export interface UsageResponse {
  appId: string;
  period: string;
  plan: { id: PlanId; name: string };
  metrics: MetricUsage[];
}

export interface WaitlistResponse {
  ok: true;
  plan: string;
}

/** `402` body of a feature the account's plan does not include (product contract). */

export interface AnalyticsDay {
  /** "YYYY-MM-DD", UTC. */
  day: string;
  searches: number;
  /** Searches that returned no result. */
  misses: number;
}

/**
 * `GET /api/apps/:id/analytics?days=7|30|90`. `days` has one entry per UTC day of the window,
 * oldest first, zeros included; the window is cut to the plan's retention. The top lists name
 * only queries searched at least 5 times in the window.
 */
export interface AnalyticsResponse {
  days: AnalyticsDay[];
  topQueries: { query: string; searches: number }[];
  topMisses: { query: string; misses: number }[];
}
