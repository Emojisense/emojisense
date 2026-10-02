/**
 * Paid plans through Whop (DECISIONS.md, "Whop for payments"). Prices come from PLANS; Whop has one
 * variant ("plan_…") per paid plan and billing interval. WHOP_PLAN_IDS maps ours to theirs, and
 * the webhook trusts only that map, never a plan named in checkout metadata.
 */
import type { D1DatabaseLike } from "./d1-like.js";
import { PLAN_IDS, PLANS, type PlanId } from "./plans.js";

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** `accounts.billing_status` (migration 0004). Keep in sync with its CHECK constraint. */
export const BILLING_STATUSES = ["none", "active", "canceling", "past_due", "canceled"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export type PaidPlanId = Exclude<PlanId, "free">;
export const PAID_PLAN_IDS = PLAN_IDS.filter((id): id is PaidPlanId => id !== "free");

/** Whop's `billing_period` in days. */
export const BILLING_PERIOD_DAYS: Record<BillingInterval, number> = { month: 30, year: 365 };

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * After a failed renewal the plan stays this long. Whop retries the charge for 5 days and then
 * cancels the membership, which normally ends the grace first.
 */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * A cancelled subscription ends with Whop's `membership.deactivated`. If that event never comes,
 * the account moves to Free this long after the paid period ended.
 */
export const CANCELED_PERIOD_SLACK_DAYS = 1;

export interface BillingOption {
  plan: PaidPlanId;
  interval: BillingInterval;
  priceUsd: number;
  periodDays: number;
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
}

export function isPaidPlan(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

/** The price of a plan for an interval; `undefined` when the plan is not sold that way. */
export function priceOf(plan: PlanId, interval: BillingInterval): number | undefined {
  const { priceUsdMonthly, priceUsdYearly } = PLANS[plan];
  if (priceUsdMonthly <= 0) return undefined;
  return interval === "month" ? priceUsdMonthly : priceUsdYearly;
}

/** The intervals a plan is sold for: monthly for every paid plan, yearly where PLANS has a price. */
export function billingIntervalsOf(plan: PlanId): BillingInterval[] {
  return BILLING_INTERVALS.filter((interval) => priceOf(plan, interval) !== undefined);
}

/** Every paid plan and interval that is for sale, in plan order. */
export function billingOptions(): BillingOption[] {
  return PAID_PLAN_IDS.flatMap((plan) =>
    billingIntervalsOf(plan).map((interval) => ({
      plan,
      interval,
      priceUsd: priceOf(plan, interval) ?? 0,
      periodDays: BILLING_PERIOD_DAYS[interval],
    })),
  );
}

/** `WHOP_PLAN_IDS`: `{"solo":{"month":"plan_…","year":"plan_…"},"pro":{"month":"plan_…"}}`. */
export type WhopPlanIds = Partial<Record<PaidPlanId, Partial<Record<BillingInterval, string>>>>;

const WHOP_PLAN_ID = /^plan_[A-Za-z0-9]{1,64}$/;

/**
 * Parses `WHOP_PLAN_IDS`. Missing or empty is `{}` (nothing for sale). Anything malformed is
 * `null`: an unknown plan or interval, an interval the plan is not sold for, or an id that is not
 * `plan_…`. A typo must not quietly sell the wrong plan.
 */
export function parseWhopPlanIds(raw: string | undefined): WhopPlanIds | null {
  if (raw === undefined || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const ids: WhopPlanIds = {};
  const seen = new Set<string>();
  for (const [plan, intervals] of Object.entries(parsed)) {
    if (!isPaidPlan(plan) || typeof intervals !== "object" || intervals === null) return null;
    const entry: Partial<Record<BillingInterval, string>> = {};
    for (const [interval, id] of Object.entries(intervals as Record<string, unknown>)) {
      if (!isBillingInterval(interval) || priceOf(plan, interval) === undefined) return null;
      if (typeof id !== "string" || !WHOP_PLAN_ID.test(id) || seen.has(id)) return null;
      seen.add(id);
      entry[interval] = id;
    }
    ids[plan] = entry;
  }
  return ids;
}

/** The value to store in WHOP_PLAN_IDS: plans and intervals in a fixed order. */
export function serializeWhopPlanIds(ids: WhopPlanIds): string {
  const ordered: WhopPlanIds = {};
  for (const plan of PAID_PLAN_IDS) {
    const entry: Partial<Record<BillingInterval, string>> = {};
    for (const interval of BILLING_INTERVALS) {
      const id = ids[plan]?.[interval];
      if (id) entry[interval] = id;
    }
    if (Object.keys(entry).length > 0) ordered[plan] = entry;
  }
  return JSON.stringify(ordered);
}

export function whopPlanIdFor(
  ids: WhopPlanIds,
  plan: PlanId,
  interval: BillingInterval,
): string | undefined {
  return plan === "free" ? undefined : ids[plan]?.[interval];
}

/** Our plan and interval for a Whop variant id; `undefined` for any variant we do not sell. */
export function findWhopPlan(
  ids: WhopPlanIds,
  whopPlanId: string,
): { plan: PaidPlanId; interval: BillingInterval } | undefined {
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (ids[plan]?.[interval] === whopPlanId) return { plan, interval };
    }
  }
  return undefined;
}

/** The intervals of each paid plan that have a Whop variant, so they can be bought. */
export function purchasableIntervals(ids: WhopPlanIds): Record<PaidPlanId, BillingInterval[]> {
  return Object.fromEntries(
    PAID_PLAN_IDS.map((plan) => [plan, billingIntervalsOf(plan).filter((i) => ids[plan]?.[i])]),
  ) as Record<PaidPlanId, BillingInterval[]>;
}

/**
 * Moves lapsed subscriptions to Free: a past-due grace that ended, or a cancelled subscription
 * whose period ended a day ago without Whop's `membership.deactivated`. With `accountId`, only that
 * account. Returns the number of accounts changed.
 */
export async function expireLapsedBilling(
  db: D1DatabaseLike,
  now: number,
  accountId?: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE accounts SET plan = 'free', billing_status = 'canceled', billing_grace_until = NULL
       WHERE ((billing_status = 'past_due' AND billing_grace_until <= ?)
          OR (billing_status = 'canceling' AND current_period_end <= ?))
         ${accountId === undefined ? "" : "AND id = ?"}`,
    )
    .bind(now, now - CANCELED_PERIOD_SLACK_DAYS * DAY_MS, ...(accountId === undefined ? [] : [accountId]))
    .run();
  return result.meta.changes;
}
