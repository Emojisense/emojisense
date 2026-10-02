import type { KeyKind } from "./keys.js";
import type { Metric, PlanId } from "./plans.js";

/**
 * Row types of migrations/0001_init.sql and migrations/0002_product.sql. The `as const` lists
 * mirror the CHECK constraints of the schema; keep them in sync with the SQL.
 */

/** Which emoji artwork the app's pickers show (`apps.emoji_set`). */
export const EMOJI_SETS = ["native", "twemoji", "noto", "fluent"] as const;
export type EmojiSet = (typeof EMOJI_SETS)[number];

/** Roles of `team_members` and `team_invites`. The owner of the apps has no row. */
export const TEAM_ROLES = ["admin", "developer", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const CUSTOM_EMOJI_CONTENT_TYPES = ["image/png", "image/gif", "image/webp", "image/svg+xml"] as const;
export type CustomEmojiContentType = (typeof CUSTOM_EMOJI_CONTENT_TYPES)[number];

export const CUSTOM_EMOJI_SOURCES = ["upload", "slack", "discord", "api"] as const;
export type CustomEmojiSource = (typeof CUSTOM_EMOJI_SOURCES)[number];

export interface AccountRow {
  id: string;
  email: string | null;
  /** Legacy (GitHub sign-in before 0003). Kept, never written. */
  github_id: string | null;
  /** The Clerk user that signs in to this account (0003). Null for dev sign-in accounts. */
  clerk_user_id: string | null;
  name: string | null;
  /** The plan of the paying account. Every app of the account gets it (0002). */
  plan: PlanId;
  created_at: number;
}

/**
 * The legacy `apps.plan` column of 0001 is left out on purpose: since 0002 the plan lives on
 * `accounts.plan`. Join the owning account to read it.
 */
export interface AppRow {
  id: string;
  account_id: string;
  name: string;
  environment: "dev" | "staging" | "prod";
  emoji_set: EmojiSet;
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

/** Another account that may work on the owner's apps (Pro and Scale). */
export interface TeamMemberRow {
  owner_id: string;
  member_id: string;
  role: TeamRole;
  created_at: number;
}

/** An invite link. Only the SHA-256 of the token is stored; the token is shown once. */
export interface TeamInviteRow {
  id: string;
  owner_id: string;
  role: TeamRole;
  token_hash: string;
  email: string | null;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
}

/** One of the app owner's own customers (Scale). */
export interface TenantRow {
  id: string;
  app_id: string;
  /** The customer's id in the owner's system. */
  external_id: string;
  name: string | null;
  created_at: number;
}

export interface CustomEmojiRow {
  id: string;
  app_id: string;
  /** "" = app-wide; otherwise a `tenants.id`. */
  tenant_id: string;
  /** Without colons: [a-z0-9_+-], 1–64 characters. */
  shortcode: string;
  /** JSON-encoded string[] of normalized search phrases. */
  aliases: string;
  /** R2 object key. */
  image_key: string;
  content_type: CustomEmojiContentType;
  bytes: number;
  source: CustomEmojiSource;
  created_at: number;
}

export interface WebhookRow {
  id: string;
  app_id: string;
  url: string;
  /** Signs deliveries (HMAC-SHA256), so it is stored as is. */
  secret: string;
  /** JSON-encoded string[] of event names. */
  events: string;
  created_at: number;
  disabled_at: number | null;
}

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  /** HTTP status; `null` = network error. */
  status: number | null;
  duration_ms: number | null;
  created_at: number;
}

/** Daily search counts per app and normalized query. */
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
