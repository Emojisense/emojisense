/**
 * Whop events → account billing state. Rules (DECISIONS.md, "Whop for payments"):
 * - The plan comes from the Whop variant id through WHOP_PLAN_IDS, never from metadata alone.
 * - A membership the account already pays with finds its account directly. A new one is matched
 *   by the checkout metadata `{ accountId, plan, interval, env }`, which must name an existing
 *   account of this environment and the same plan as the variant.
 * - Whop does not keep events in order. Per membership, whop_memberships keeps the newest state
 *   and its time: an activation older than a stored deactivation grants nothing, and one older
 *   than a stored cancellation grants a cancelled plan. Per account, an event of the membership it
 *   pays with that is older than the last one applied changes nothing.
 * - A retired membership (replaced by a newer plan, or of a deleted account) never activates an
 *   account again; memberships.ts cancels it until Whop confirms.
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
  type WhopMembershipRow,
  type WhopMembershipState,
  type WhopPlanIds,
} from "@emojisense/platform";
import type { D1Database, D1PreparedStatement } from "../d1";
import { isValidId } from "../validate";
import {
  attachMembership,
  type CancelEffect,
  membershipRow,
  recordMembership,
  retireMembership,
} from "./memberships";

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
  | "retired_membership"
  | "membership_ended"
  | "not_paying"
  | "stale";

/**
 * What a verified event changes, as statements for one D1 batch. An ignored event can still
 * record its membership's state (whop_memberships), so a later, older event is judged against it.
 */
export type WhopEventPlan =
  | { result: "applied"; accountId: string; status: BillingStatus; statements: D1PreparedStatement[] }
  | { result: "ignored"; reason: IgnoreReason; statements: D1PreparedStatement[] };

export interface WhopEventContext {
  db: D1Database;
  planIds: WhopPlanIds;
  /** This Worker's `env` label in checkout metadata. */
  environment: string;
}

/** Statuses in which the account pays, so a newer membership replaces the stored one. */
const PAYING: ReadonlySet<BillingStatus> = new Set(["active", "canceling", "past_due"]);

const MEMBERSHIP_STATE_OF: Record<BillingStatus, WhopMembershipState> = {
  none: "active",
  active: "active",
  canceling: "canceling",
  past_due: "past_due",
  canceled: "ended",
};

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

const ignored = (reason: IgnoreReason, statements: D1PreparedStatement[] = []): WhopEventPlan => ({
  result: "ignored",
  reason,
  statements,
});

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
 * The order check inside each UPDATE of the paying membership, so two events of one account
 * handled at the same time cannot let the older one win. Binds: the event time.
 */
const NOT_OLDER = "(billing_event_at IS NULL OR billing_event_at <= ?)";

/** The membership state an event reports. */
function reportedState(event: WhopEvent): WhopMembershipState {
  switch (event.type) {
    case "payment.failed":
      return "past_due";
    case "membership.deactivated":
      return event.status === "past_due" ? "past_due" : "ended";
    default:
      return event.cancelAtPeriodEnd ? "canceling" : "active";
  }
}

/** For a retired membership: renewing means cancel it again; a reported cancel confirms ours. */
function cancelEffect(event: WhopEvent): CancelEffect {
  if (event.type === "membership.cancel_at_period_end_changed") {
    if (event.cancelAtPeriodEnd === null) return "keep";
    return event.cancelAtPeriodEnd ? "confirm" : "reset";
  }
  if (event.type === "payment.succeeded" || event.type === "membership.activated") {
    return event.cancelAtPeriodEnd ? "confirm" : "reset";
  }
  return "keep";
}

interface Known {
  membershipId: string;
  stored: WhopMembershipRow | null;
  /** The account that pays with this membership now, if any. */
  account: AccountRow | null;
  /** Ours: its variant is in WHOP_PLAN_IDS, or it is stored or paid with already. */
  ours: boolean;
}

async function lookUp(ctx: WhopEventContext, event: WhopEvent, membershipId: string): Promise<Known> {
  const [stored, account] = await Promise.all([
    membershipRow(ctx.db, membershipId),
    accountByMembership(ctx.db, membershipId),
  ]);
  const ours =
    stored !== null ||
    account !== null ||
    (event.whopPlanId !== null && findWhopPlan(ctx.planIds, event.whopPlanId) !== undefined);
  return { membershipId, stored, account, ours };
}

/** Records this event's state of the membership; other companies' products are not stored. */
function recordFor(
  ctx: WhopEventContext,
  event: WhopEvent,
  known: Known,
  accountId: string | null,
): D1PreparedStatement[] {
  if (!known.ours) return [];
  const recorded = recordMembership(ctx.db, {
    id: known.membershipId,
    accountId,
    state: reportedState(event),
    periodEnd: event.periodEnd,
    at: event.at,
    cancel: cancelEffect(event),
  });
  // An older event does not change the stored state, but it can still name the account.
  return accountId ? [recorded, attachMembership(ctx.db, known.membershipId, accountId)] : [recorded];
}

/** payment.succeeded and membership.activated: the account gets the paid plan. */
async function activate(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  if (!event.membershipId || !event.whopPlanId) return ignored("missing_fields");
  const membershipId = event.membershipId;
  const known = await lookUp(ctx, event, membershipId);
  const recorded = (accountId: string | null) => recordFor(ctx, event, known, accountId);
  if (known.stored?.retired_at != null) {
    return ignored("retired_membership", recorded(known.stored.account_id));
  }
  const bought = findWhopPlan(ctx.planIds, event.whopPlanId);
  if (!bought) return ignored("unknown_plan", recorded(known.account?.id ?? null));

  let account = known.account;
  const isNew = account === null;
  if (account) {
    const claimed = text(event.metadata.accountId);
    if (claimed && claimed !== account.id) return ignored("account_mismatch", recorded(account.id));
    if (isStale(account, event)) return ignored("stale", recorded(account.id));
  } else {
    const found = await accountFromMetadata(ctx, event);
    if ("reason" in found) return ignored(found.reason, recorded(null));
    const { plan, interval } = event.metadata;
    if (plan !== bought.plan || (interval !== undefined && interval !== bought.interval)) {
      return ignored("plan_mismatch", recorded(null));
    }
    account = found.account;
  }

  // A newer event about this membership came first: it limits what the activation grants.
  const newer = known.stored && known.stored.event_at > event.at ? known.stored : null;
  if (newer?.state === "ended") return ignored("membership_ended", recorded(account.id));
  let status: BillingStatus = event.cancelAtPeriodEnd ? "canceling" : "active";
  let graceUntil: number | null = null;
  if (newer?.state === "canceling") status = "canceling";
  if (newer?.state === "past_due") {
    status = "past_due";
    graceUntil = newer.event_at + PAST_DUE_GRACE_DAYS * DAY_MS;
  }
  const eventAt = Math.max(event.at, newer?.event_at ?? 0);

  // Payments carry no period: estimate it from the payment until a membership event says.
  const estimate = (event.paidAt ?? event.at) + BILLING_PERIOD_DAYS[bought.interval] * DAY_MS;
  const periodEnd =
    newer?.period_end ??
    event.periodEnd ??
    (!isNew && account.current_period_end !== null
      ? Math.max(account.current_period_end, estimate)
      : estimate);
  const manageUrl = event.manageUrl ?? (isNew ? null : account.whop_manage_url);
  // The paying membership: the order check. A new one: the account must still pay with the
  // membership read above, so two new memberships handled at once cannot both win.
  const guard = isNew ? "whop_membership_id IS ?" : `whop_membership_id = ? AND ${NOT_OLDER}`;
  const guardValues = isNew ? [account.whop_membership_id] : [membershipId, event.at];
  const update = ctx.db
    .prepare(
      `UPDATE accounts SET plan = ?, billing_status = ?, billing_interval = ?, whop_membership_id = ?,
         current_period_end = ?, billing_grace_until = ?, whop_manage_url = ?, billing_event_at = ?
       WHERE id = ? AND ${guard}`,
    )
    .bind(
      bought.plan,
      status,
      bought.interval,
      membershipId,
      periodEnd,
      graceUntil,
      manageUrl,
      eventAt,
      account.id,
      ...guardValues,
    );

  const statements = [...recorded(account.id), update];
  const previous = account.whop_membership_id;
  if (isNew && previous && PAYING.has(account.billing_status)) {
    // The replaced membership must stop renewing; memberships.ts cancels it after the answer.
    statements.push(
      retireMembership(ctx.db, {
        id: previous,
        accountId: account.id,
        state: MEMBERSHIP_STATE_OF[account.billing_status],
        at: eventAt,
      }),
    );
  }
  return { result: "applied", accountId: account.id, status, statements };
}

/** The account that pays with the event's membership, for events that may only change that one. */
async function currentAccount(
  ctx: WhopEventContext,
  event: WhopEvent,
): Promise<{ account: AccountRow; recorded: D1PreparedStatement[] } | { ignore: WhopEventPlan }> {
  if (!event.membershipId) return { ignore: ignored("missing_fields") };
  const known = await lookUp(ctx, event, event.membershipId);
  const { account, stored } = known;
  if (!account) {
    // No account pays with it: retired, not activated yet (its state waits in whop_memberships
    // for the activation), a failed first checkout, or another environment's.
    const reason = stored?.retired_at != null ? "retired_membership" : "unknown_membership";
    return { ignore: ignored(reason, recordFor(ctx, event, known, stored?.account_id ?? null)) };
  }
  const recorded = recordFor(ctx, event, known, account.id);
  if (isStale(account, event)) return { ignore: ignored("stale", recorded) };
  return { account, recorded };
}

/** payment.failed: the plan stays for the grace period while Whop retries the charge. */
async function pastDue(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  const found = await currentAccount(ctx, event);
  if ("ignore" in found) return found.ignore;
  const { account, recorded } = found;
  if (!PAYING.has(account.billing_status)) return ignored("not_paying", recorded);
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
  return { result: "applied", accountId: account.id, status: "past_due", statements: [...recorded, update] };
}

/** membership.deactivated: the paid period is over, the account moves to Free. */
async function deactivate(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  // Whop also deactivates a past-due membership when "access while past due" is off: that is the
  // grace period, not the end.
  if (event.status === "past_due") return pastDue(ctx, event);
  const found = await currentAccount(ctx, event);
  if ("ignore" in found) return found.ignore;
  const { account, recorded } = found;
  const update = ctx.db
    .prepare(
      `UPDATE accounts SET plan = 'free', billing_status = 'canceled', billing_grace_until = NULL,
         current_period_end = COALESCE(?, current_period_end), billing_event_at = ?
       WHERE id = ? AND whop_membership_id = ? AND ${NOT_OLDER}`,
    )
    .bind(event.periodEnd, event.at, account.id, account.whop_membership_id, event.at);
  return { result: "applied", accountId: account.id, status: "canceled", statements: [...recorded, update] };
}

/** membership.cancel_at_period_end_changed: cancelled (paid until the period ends) or resumed. */
async function cancelAtPeriodEnd(ctx: WhopEventContext, event: WhopEvent): Promise<WhopEventPlan> {
  const found = await currentAccount(ctx, event);
  if ("ignore" in found) return found.ignore;
  const { account, recorded } = found;
  if (event.cancelAtPeriodEnd === null) return ignored("missing_fields", recorded);
  if (!PAYING.has(account.billing_status)) return ignored("not_paying", recorded);
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
  return { result: "applied", accountId: account.id, status, statements: [...recorded, update] };
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
