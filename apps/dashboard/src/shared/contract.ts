/**
 * JSON shapes of the dashboard API (docs/API.md, "Dashboard API"). The Worker produces them and
 * the SPA consumes them, so both import from here. Times are Unix epoch milliseconds.
 */
import type { EmojiSet, KeyKind, Metric, PlanId, TeamRole } from "@emojisense/platform";

export type Environment = "dev" | "staging" | "prod";
export const ENVIRONMENTS: readonly Environment[] = ["prod", "staging", "dev"];

/**
 * What the signed-in account may do on an app or team. The owner has no `team_members` row.
 * owner > admin (all but changing the plan) > developer (apps, keys; no team) > viewer (read only).
 */
export type Role = "owner" | TeamRole;

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
  hostedEmojiSets: boolean;
  /** 0 = no analytics. */
  analyticsRetentionDays: number;
  teamMembers: boolean;
  tenants: boolean;
}

/** A team the signed-in account belongs to (not its own). */
export interface TeamSummary {
  ownerId: string;
  /** The owner's name, or email when the name is empty. */
  ownerName: string | null;
  role: TeamRole;
}

export interface MeResponse {
  account: AccountSummary;
  /** The account's own plan (`accounts.plan`). Its apps get it. */
  plan: PlanSummary;
  /** Apps the account owns; `plan.maxApps` limits this number. */
  appCount: number;
  /** Plan the account's email is on the waitlist for, if any. */
  waitlistPlan: string | null;
  /** Teams of other owners that this account is a member of. */
  teams: TeamSummary[];
}

export interface AppSummary {
  id: string;
  name: string;
  environment: Environment;
  /** The owning account's plan. */
  plan: PlanId;
  emojiSet: EmojiSet;
  createdAt: number;
  activeKeyCount: number;
  /** The signed-in account's role on this app. */
  role: Role;
  ownerId: string;
  ownerName: string | null;
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

export interface TeamMemberSummary {
  /** Account id. */
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  /** When the member joined; for the owner, when the account was created. */
  createdAt: number;
}

export interface TeamInviteSummary {
  id: string;
  role: TeamRole;
  /** A label for the admins. It is not checked when the invite is accepted. */
  email: string | null;
  createdAt: number;
  expiresAt: number;
}

/** `GET /api/team[?owner=<accountId>]`. Members list the owner first. */
export interface TeamResponse {
  ownerId: string;
  /** The signed-in account's role on this team. */
  role: Role;
  members: TeamMemberSummary[];
  /** Open invites: not accepted and not expired. */
  invites: TeamInviteSummary[];
}

/** The `url` (`<dashboard>/invite/<token>`) appears only in this response. */
export interface CreatedInviteResponse {
  invite: TeamInviteSummary;
  url: string;
}

export interface TeamMemberResponse {
  member: TeamMemberSummary;
}

export interface AcceptInviteResponse {
  team: TeamSummary;
}

export interface BillingResponse {
  plan: PlanSummary;
  /** "YYYY-MM" (UTC). */
  period: string;
  /** This period's totals over all apps the account owns; custom_emoji = emoji stored now. */
  usage: MetricUsage[];
  limits: Record<Metric, number | null> & { apps: number | null };
  appCount: number;
  /** No billing provider is chosen yet. */
  provider: null;
  waitlistPlan: string | null;
}

export interface UpgradeResponse {
  status: "waitlist";
  plan: PlanId;
}

export interface OkResponse {
  ok: true;
}
