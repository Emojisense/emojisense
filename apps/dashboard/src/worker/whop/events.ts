/**
 * Whop events → account billing state. Rules (DECISIONS.md, "Whop for payments"):
 * - The plan comes from the Whop variant id through WHOP_PLAN_IDS, never from metadata alone.
 * - A membership the account already pays with finds its account directly. A new one is matched
 *   by the checkout metadata `{ accountId, plan, interval, env }`, which must name an existing
 *   account of this environment and the same plan as the variant.
 * - Whop does not keep events in order: an event older than the last one applied to the account
 *   changes nothing.
 * - Anything else is ignored with a reason: the webhook still answers 200, so Whop stops retrying.
 *
 * Payload fields are read in both of Whop's shapes: the current one (`plan_id`, `membership_id`,
 * `current_period_end`) and the legacy one (`plan.id`, `membership.id`, `renewal_period_end`).
 */
import {
  type AccountRow,
  BILLING_PERIOD_DAYS,
  type BillingStatus,
  DAY_MS,
  findWhopPlan,
  PAST_DUE_GRACE_DAYS,
  type WhopPlanIds,
} from "@emojisense/platform";
import type { D1Database, D1PreparedStatement } from "../d1";
import { isValidId } from "../validate";

export const WHOP_EVENT_TYPES = [
  "payment.succeeded",
  "payment.failed",
  "membership.activated",
  "membership.deactivated",
  "membership.cancel_at_period_end_changed",
] as const;
export type WhopEventType = (typeof WHOP_EVENT_TYPES)[number];

export interface WhopEvent {
  type: WhopEventType;
  /** When Whop created the event, epoch ms. */
  at: number;
  membershipId: string | null;
  /** The Whop variant, `plan_…`. */
  whopPlanId: string | null;
  metadata: Record<string, unknown>;
  status: string | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean | null;
  manageUrl: string | null;
  paidAt: number | null;
}

export type IgnoreReason =
  | "missing_fields"
  | "missing_metadata"
  | "other_environment"
  | "unknown_account"
  | "unknown_plan"
  | "plan_mismatch"
  | "account_mismatch"
  | "unknown_membership"
  | "not_paying"
  | "stale";

export type WhopEventPlan =
  | {
      result: "applied";
      accountId: string;
      status: BillingStatus;
      statements: D1PreparedStatement[];
      /** The membership the account paid with before, now replaced: cancel it at period end. */
      replacedMembershipId: string | null;
    }
  | { result: "ignored"; reason: IgnoreReason };

export interface WhopEventContext {
  db: D1Database;
  planIds: WhopPlanIds;
  /** This Worker's `env` label in checkout metadata. */
  environment: string;
}

/** Statuses in which the account pays, so a newer membership replaces the stored one. */
const PAYING: ReadonlySet<BillingStatus> = new Set(["active", "canceling", "past_due"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** An id given as a string or as `{ id }`. */
function idOf(value: unknown): string | null {
  return text(value) ?? text(record(value)?.id);
}

/** ISO 8601, or a Unix time in seconds or milliseconds. */
function timeOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value !== "string" || value === "") return null;
  if (/^\d+$/.test(value)) return timeOf(Number(value));
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Whop's own https pages only; anything else is dropped. */
function manageUrlOf(value: unknown): string | null {
  const url = text(value);
  if (!url || !URL.canParse(url)) return null;
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" && (hostname === "whop.com" || hostname.endsWith(".whop.com")) ? url : null;
}

export function isWhopEventType(value: unknown): value is WhopEventType {
  return typeof value === "string" && (WHOP_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The fields of a verified delivery that billing uses; `null` for event types we do not handle.
 * `fallbackAt` (the signed `webhook-timestamp`) is used when the envelope has no timestamp.
 */
export function parseWhopEvent(body: unknown, fallbackAt: number): WhopEvent | null {
  const envelope = record(body);
  const type = envelope?.type;
  const data = record(envelope?.data);
  if (!envelope || !data || !isWhopEventType(type)) return null;
  const isMembership = type.startsWith("membership.");
  return {
    type,
    at: timeOf(envelope.timestamp) ?? fallbackAt,
    membershipId: isMembership ? idOf(data.id) : (text(data.membership_id) ?? idOf(data.membership)),
    whopPlanId: text(data.plan_id) ?? idOf(data.plan),
    metadata: record(data.metadata) ?? {},
    status: text(data.status),
    periodEnd: isMembership ? timeOf(data.current_period_end ?? data.renewal_period_end) : null,
    cancelAtPeriodEnd: typeof data.cancel_at_period_end === "boolean" ? data.cancel_at_period_end : null,
    manageUrl: manageUrlOf(data.manage_url),
    paidAt: isMembership ? null : timeOf(data.paid_at ?? data.created_at),
  };
}

const ignored = (reason: IgnoreReason): WhopEventPlan => ({ result: "ignored", reason });

async function accountByMembership(db: D1Database, membershipId: string): Promise<AccountRow | null> {
  return db
    .prepare("SELECT * FROM accounts WHERE whop_membership_id = ?")
    .bind(membershipId)
    .first<AccountRow>();
}

async function accountFromMetadata(
  ctx: WhopEventContext,
  event: WhopEvent,
): Promise<{ account: AccountRow } | { reason: IgnoreReason }> {
  const accountId = text(event.metadata.accountId);
  const environment = text(event.metadata.env);
  if (!accountId || !environment) return { reason: "missing_metadata" };
  if (environment !== ctx.environment) return { reason: "other_environment" };
  if (!isValidId(accountId)) return { reason: "unknown_account" };
  const account = await ctx.db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<AccountRow>();
  return account ? { account } : { reason: "unknown_account" };
}

const isStale = (account: AccountRow, event: WhopEvent) =>
  account.billing_event_at !== null && event.at < account.billing_event_at;

/**
 * The same rule inside each UPDATE, so two events of one account handled at the same time cannot
 * let the older one win. Binds: the event time.
 */
const NOT_OLDER = "(billing_event_at IS NULL OR billing_event_at <= ?)";

/** payment.succeeded and membership.activated: the account gets the paid plan. */
async function activate(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  if (!event.membershipId || !event.whopPlanId) return ignored("missing_fields");
  const bought = findWhopPlan(ctx.planIds, event.whopPlanId);
  if (!bought) return ignored("unknown_plan");

  let account = await accountByMembership(ctx.db, event.membershipId);
  if (account) {
    const claimed = text(event.metadata.accountId);
    if (claimed && claimed !== account.id) return ignored("account_mismatch");
  } else {
    const found = await accountFromMetadata(ctx, event);
    if ("reason" in found) return ignored(found.reason);
    const { plan, interval } = event.metadata;
    if (plan !== bought.plan || (interval !== undefined && interval !== bought.interval)) {
      return ignored("plan_mismatch");
    }
    account = found.account;
  }
  if (isStale(account, event)) return ignored("stale");

  const sameMembership = account.whop_membership_id === event.membershipId;
  const replacedMembershipId =
    !sameMembership && account.whop_membership_id && PAYING.has(account.billing_status)
      ? account.whop_membership_id
      : null;
  // Payments carry no period: estimate it from the payment until a membership event says.
  const estimate = (event.paidAt ?? event.at) + BILLING_PERIOD_DAYS[bought.interval] * DAY_MS;
  const periodEnd =
    event.periodEnd ??
    (sameMembership && account.current_period_end !== null
      ? Math.max(account.current_period_end, estimate)
      : estimate);
  const status: BillingStatus = event.cancelAtPeriodEnd ? "canceling" : "active";
  const manageUrl = event.manageUrl ?? (sameMembership ? account.whop_manage_url : null);
  const update = ctx.db
    .prepare(
      `UPDATE accounts SET plan = ?, billing_status = ?, billing_interval = ?, whop_membership_id = ?,
         current_period_end = ?, billing_grace_until = NULL, whop_manage_url = ?, billing_event_at = ?
       WHERE id = ? AND ${NOT_OLDER}`,
    )
    .bind(
      bought.plan,
      status,
      bought.interval,
      event.membershipId,
      periodEnd,
      manageUrl,
      event.at,
      account.id,
      event.at,
    );
  return { result: "applied", accountId: account.id, status, statements: [update], replacedMembershipId };
}

/** The stored membership of an account, for events that may only change that one. */
async function currentAccount(
  ctx: WhopEventContext,
  event: WhopEvent,
): Promise<{ account: AccountRow } | { reason: IgnoreReason }> {
  if (!event.membershipId) return { reason: "missing_fields" };
  // A membership no account pays with: a replaced one, a failed first checkout, or another
  // environment's (one Whop company can sell for dev and production).
  const account = await accountByMembership(ctx.db, event.membershipId);
  if (!account) return { reason: "unknown_membership" };
  if (isStale(account, event)) return { reason: "stale" };
  return { account };
}

/** payment.failed: the plan stays for the grace period while Whop retries the charge. */
async function pastDue(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  const found = await currentAccount(ctx, event);
  if ("reason" in found) return ignored(found.reason);
  const { account } = found;
  if (!PAYING.has(account.billing_status)) return ignored("not_paying");
  const graceUntil =
    account.billing_status === "past_due" && account.billing_grace_until !== null
      ? account.billing_grace_until
      : event.at + PAST_DUE_GRACE_DAYS * DAY_MS;
  const update = ctx.db
    .prepare(
      `UPDATE accounts SET billing_status = 'past_due', billing_grace_until = ?, billing_event_at = ?
       WHERE id = ? AND whop_membership_id = ? AND ${NOT_OLDER}`,
    )
    .bind(graceUntil, event.at, account.id, account.whop_membership_id, event.at);
  return {
    result: "applied",
    accountId: account.id,
    status: "past_due",
    statements: [update],
    replacedMembershipId: null,
  };
}

/** membership.deactivated: the paid period is over, the account moves to Free. */
async function deactivate(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  // Whop also deactivates a past-due membership when "access while past due" is off: that is the
  // grace period, not the end.
  if (event.status === "past_due") return pastDue(ctx, event);
  const found = await currentAccount(ctx, event);
  if ("reason" in found) return ignored(found.reason);
  const update = ctx.db
    .prepare(
      `UPDATE accounts SET plan = 'free', billing_status = 'canceled', billing_grace_until = NULL,
         current_period_end = COALESCE(?, current_period_end), billing_event_at = ?
       WHERE id = ? AND whop_membership_id = ? AND ${NOT_OLDER}`,
    )
    .bind(event.periodEnd, event.at, found.account.id, found.account.whop_membership_id, event.at);
  return {
    result: "applied",
    accountId: found.account.id,
    status: "canceled",
    statements: [update],
    replacedMembershipId: null,
  };
}

/** membership.cancel_at_period_end_changed: cancelled (paid until the period ends) or resumed. */
async function cancelAtPeriodEnd(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  const found = await currentAccount(ctx, event);
  if ("reason" in found) return ignored(found.reason);
  const { account } = found;
  if (event.cancelAtPeriodEnd === null) return ignored("missing_fields");
  if (!PAYING.has(account.billing_status)) return ignored("not_paying");
  const status: BillingStatus = event.cancelAtPeriodEnd
    ? "canceling"
    : account.billing_status === "canceling"
      ? "active"
      : account.billing_status;
  const update = ctx.db
    .prepare(
      `UPDATE accounts SET billing_status = ?, current_period_end = COALESCE(?, current_period_end),
         whop_manage_url = COALESCE(?, whop_manage_url), billing_event_at = ?
       WHERE id = ? AND whop_membership_id = ? AND ${NOT_OLDER}`,
    )
    .bind(
      status,
      event.periodEnd,
      event.manageUrl,
      event.at,
      account.id,
      account.whop_membership_id,
      event.at,
    );
  return {
    result: "applied",
    accountId: account.id,
    status,
    statements: [update],
    replacedMembershipId: null,
  };
}

/** What a verified event changes. Reads only; the caller runs the statements in one batch. */
export async function planWhopEvent(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  switch (event.type) {
    case "payment.succeeded":
    case "membership.activated":
      return activate(ctx, event);
    case "payment.failed":
      return pastDue(ctx, event);
    case "membership.deactivated":
      return deactivate(ctx, event);
    case "membership.cancel_at_period_end_changed":
      return cancelAtPeriodEnd(ctx, event);
  }
}
