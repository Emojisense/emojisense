/**
 * JSON shapes of the dashboard API (docs/API.md, "Dashboard API"). The Worker produces them and
 * the SPA consumes them, so both import from here. Times are Unix epoch milliseconds.
 */
import type {
  BillingInterval,
  BillingStatus,
  CustomEmoji,
  EmojiSet,
  KeyKind,
  Metric,
  PaidPlanId,
  PlanId,
  TeamRole,
  WebhookEnvelopeType,
  WebhookEventType,
} from "@emojisense/platform";

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

/** GET /api/admin: whether the internal pages show for this account (ADMIN_EMAILS). */
export interface AdminStatusResponse {
  admin: boolean;
  /** The Culture page works: the account is an admin and the API Worker is bound. */
  culture: boolean;
}

export interface AccountSummary {
  id: string;
  name: string | null;
  email: string | null;
  /** How the account signs in: Clerk, or the local dev sign-in. */
  signIn: "clerk" | "dev";
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
  /** The account's own subscription state; `past_due` means a renewal failed. */
  billingStatus: BillingStatus;
  /** Teams of other owners that this account is a member of. */
  teams: TeamSummary[];
}

/** What an account without an email types to confirm `DELETE /api/me`. */
export const DELETE_ACCOUNT_PHRASE = "delete my account";

/**
 * `DELETE /api/me` body. `confirm` is the account's email (any case), or DELETE_ACCOUNT_PHRASE
 * when the account has no email. The answer is `DeleteAccountResponse`.
 */
export interface DeleteAccountRequest {
  confirm: string;
}

export interface DeleteAccountResponse {
  ok: true;
  /**
   * The Worker deleted the Clerk user too (only when it has CLERK_SECRET_KEY). When `false`, the
   * SPA deletes the Clerk user with Clerk JS.
   */
  clerkUserDeleted: boolean;
}

/** The text that confirms the deletion of an account with this email. */
export function deleteAccountConfirmation(email: string | null): string {
  return email ?? DELETE_ACCOUNT_PHRASE;
}

/** Case and surrounding spaces do not matter, so a pasted address still matches. */
export function isDeleteAccountConfirmed(email: string | null, typed: unknown): boolean {
  return (
    typeof typed === "string" && typed.trim().toLowerCase() === deleteAccountConfirmation(email).toLowerCase()
  );
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

/** One metric of one app: the account's total against the plan limit, and this app's part of it. */
export interface AppMetricUsage extends MetricUsage {
  /** This app's count. `used`, `percent` and `status` count every app of the account. */
  appUsed: number;
}

export interface UsageResponse {
  appId: string;
  period: string;
  plan: { id: PlanId; name: string };
  /**
   * Plan limits belong to the account, so each metric is measured on the account's total over
   * all of its apps: the total the API's `overLimit` uses.
   */
  metrics: AppMetricUsage[];
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

/** Searches of one country over the window. */
export interface AnalyticsCountry {
  /** ISO 3166-1 alpha-2 country of the requests (from Cloudflare's edge); "XX" = unknown. */
  country: string;
  searches: number;
  misses: number;
}

/** Searches of one pack locale over the window. */
export interface AnalyticsLocale {
  /** A pack locale such as "pt"; "und" = searches from before the locale was counted. */
  locale: string;
  searches: number;
  misses: number;
}

/**
 * `GET /api/apps/:id/analytics?days=7|30|90[&country=BR][&locale=pt]`. `days` has one entry per
 * UTC day of the window, oldest first, zeros included; the window is cut to the plan's retention.
 * The top lists name only queries searched at least 5 times in the window (and filter).
 * `country` and `locale` filter every part except their own breakdown: `countries` follows the
 * locale filter only, `locales` the country filter only. Only the app's own searches count.
 */
export interface AnalyticsResponse {
  days: AnalyticsDay[];
  topQueries: { query: string; searches: number }[];
  topMisses: { query: string; misses: number }[];
  /** At most 50, most searches first. */
  countries: AnalyticsCountry[];
  /** At most 50, most searches first. */
  locales: AnalyticsLocale[];
  /** The filters applied, normalized (country uppercase, locale lowercase). */
  filters: AnalyticsFilters;
}

export interface AnalyticsFilters {
  country: string | null;
  locale: string | null;
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

/** The account's Whop subscription, as the last Whop event left it. */
export interface BillingSubscription {
  /**
   * none: never paid. active: renews at `currentPeriodEnd`. canceling: cancelled, the plan stays
   * until `currentPeriodEnd`. past_due: a renewal failed, the plan stays until `graceUntil`.
   * canceled: ended, the account is on Free.
   */
  status: BillingStatus;
  interval: BillingInterval | null;
  currentPeriodEnd: number | null;
  graceUntil: number | null;
  /** Whop's page to change the card or cancel. Only the owner gets it; null without a subscription. */
  manageUrl: string | null;
}

export interface BillingResponse {
  plan: PlanSummary;
  /** "YYYY-MM" (UTC). */
  period: string;
  /** This period's totals over all apps the account owns; custom_emoji = emoji stored now. */
  usage: MetricUsage[];
  limits: Record<Metric, number | null> & { apps: number | null };
  appCount: number;
  /** "whop" when this server can sell plans; null when payments are not set up. */
  provider: "whop" | null;
  subscription: BillingSubscription;
  /** The intervals of each paid plan that can be bought now (yearly: Solo only). */
  purchasable: Record<PaidPlanId, BillingInterval[]>;
}

/** `POST /api/billing/checkout` (owner only). `interval` defaults to "month". */
export interface CheckoutRequest {
  plan: PaidPlanId;
  interval?: BillingInterval;
}

/** Whop's hosted checkout. After paying, Whop sends the buyer to `/billing?checkout=success`. */
export interface CheckoutResponse {
  url: string;
}

export interface OkResponse {
  ok: true;
}

/** One of the app owner's own customers (Scale). `externalId` is the id in the owner's system. */
export interface TenantSummary {
  id: string;
  externalId: string;
  name: string | null;
  createdAt: number;
  /** Custom emoji of this tenant. */
  emojiCount: number;
}

/** `GET /api/apps/:id/tenants?limit=&cursor=`, ordered by externalId. */
export interface TenantsResponse {
  tenants: TenantSummary[];
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface TenantResponse {
  tenant: TenantSummary;
}

export interface DeletedTenantResponse {
  tenant: TenantSummary;
  /** Custom emoji (rows and images) deleted with the tenant. */
  emojiDeleted: number;
}

export interface WebhookDeliverySummary {
  id: string;
  event: WebhookEnvelopeType;
  /** HTTP status; null = network error, timeout or a refused target. */
  status: number | null;
  /** A 2xx answer. */
  ok: boolean;
  durationMs: number | null;
  createdAt: number;
}

/** The secret is never listed: it appears once, in CreatedWebhookResponse. */
export interface WebhookSummary {
  id: string;
  appId: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  createdAt: number;
  disabledAt: number | null;
  lastDelivery: WebhookDeliverySummary | null;
}

export interface WebhooksResponse {
  webhooks: WebhookSummary[];
}

export interface WebhookResponse {
  webhook: WebhookSummary;
}

/** `secret` (`whsec_…`) signs every delivery. This is the only response that carries it. */
export interface CreatedWebhookResponse {
  webhook: WebhookSummary;
  secret: string;
}

/** The last 50 deliveries, newest first. */
export interface WebhookDeliveriesResponse {
  deliveries: WebhookDeliverySummary[];
}

/** `POST /api/webhooks/:id/test`: one `webhook.test` event, sent at once, no retries. */
export interface WebhookTestResponse {
  delivery: WebhookDeliverySummary;
}

/** `{ id, shortcode, aliases, imageUrl, tenantId, source, bytes, createdAt }` (product contract). */
export type { CustomEmoji };

/**
 * `GET /api/apps/:id/emoji[?tenantId=]`, newest first. `used` counts what the plan's `limit`
 * counts: every emoji of every app of the owning account, tenants included; `null` = unlimited.
 */
export interface CustomEmojiListResponse {
  emoji: CustomEmoji[];
  used: number;
  limit: number | null;
}

export type EmojiImportSkipReason = "alias" | "exists" | "invalid" | "limit" | "failed";

/**
 * `POST /api/apps/:id/emoji/import/slack|discord`. One call imports at most 50 new emoji; while
 * `remaining > 0`, call again (already imported ones then count as `exists`).
 */
export interface EmojiImportResponse {
  imported: number;
  /** Sum of `skippedBy`. */
  skipped: number;
  /** New emoji that fit the plan but wait for the next call. */
  remaining: number;
  skippedBy: Record<EmojiImportSkipReason, number>;
}
