/**
 * Plans are sold through Whop (DECISIONS.md, "Whop for payments"). Checkout only starts a Whop
 * checkout; the plan changes when Whop's webhook confirms the payment (routes/whop.ts).
 */
import {
  type AccountRow,
  billingLapsed,
  expireLapsedBilling,
  getPlan,
  METRICS,
  type Metric,
  periodOf,
  purchasableIntervals,
  whopPlanIdFor,
} from "@emojisense/platform";
import type { BillingResponse, BillingSubscription, CheckoutResponse } from "../../shared/contract";
import { requireTeamAccess } from "../access";
import type { D1Database } from "../d1";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { finiteOrNull, measureUsage, toPlanSummary } from "../plans";
import { parseBillingInterval, parsePaidPlan } from "../validate";
import { createCheckout, WhopApiError } from "../whop/api";
import { billingEnvironment, whopApi, whopOrdersUrl, whopPlanIds } from "../whop/config";
import { cancelRetiredMemberships, retireMembership } from "../whop/memberships";

/**
 * The account as billing sees it now. A subscription whose grace or cancelled period ran out moves
 * to Free first, so the dashboard never shows a plan that already lapsed.
 */
export async function currentBilling(db: D1Database, account: AccountRow, now: number): Promise<AccountRow> {
  if (!billingLapsed(account, now)) return account;
  await expireLapsedBilling(db, now, account.id);
  return (
    (await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(account.id).first<AccountRow>()) ?? account
  );
}

function toSubscription(ctx: AuthedContext, owner: AccountRow, isOwner: boolean): BillingSubscription {
  const hasMembership = owner.whop_membership_id !== null && owner.billing_status !== "none";
  return {
    status: owner.billing_status,
    interval: owner.billing_interval,
    currentPeriodEnd: owner.current_period_end,
    graceUntil: owner.billing_status === "past_due" ? owner.billing_grace_until : null,
    manageUrl: isOwner && hasMembership ? (owner.whop_manage_url ?? whopOrdersUrl(ctx.env)) : null,
  };
}

/** `GET /api/billing[?owner=]` (owner or admin): the plan, the subscription, this month's usage. */
export async function getBilling(ctx: AuthedContext): Promise<Response> {
  const access = await requireTeamAccess(ctx, "view_billing");
  const db = ctx.env.DB;
  const now = ctx.deps.now();
  const owner = await currentBilling(db, access.owner, now);
  const plan = getPlan(owner.plan);
  const period = periodOf(now);
  const [metered, stored, apps] = await Promise.all([
    db
      .prepare(
        `SELECT u.metric, SUM(u.count) AS count FROM usage_monthly u JOIN apps a ON a.id = u.app_id
         WHERE a.account_id = ? AND u.period = ? GROUP BY u.metric`,
      )
      .bind(owner.id, period)
      .all<{ metric: Metric; count: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM custom_emoji c JOIN apps a ON a.id = c.app_id WHERE a.account_id = ?",
      )
      .bind(owner.id)
      .first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM apps WHERE account_id = ?").bind(owner.id).first<{ n: number }>(),
  ]);
  const used = new Map(metered.results.map((row) => [row.metric, row.count]));
  // Custom emoji are a stored count, not a monthly counter.
  used.set("custom_emoji", stored?.n ?? 0);

  const api = whopApi(ctx.env);
  const body: BillingResponse = {
    plan: toPlanSummary(plan),
    period,
    usage: METRICS.map((metric) => measureUsage(metric, used.get(metric) ?? 0, plan.limits[metric])),
    limits: {
      ...(Object.fromEntries(METRICS.map((m) => [m, finiteOrNull(plan.limits[m])])) as Record<
        Metric,
        number | null
      >),
      apps: finiteOrNull(plan.maxApps),
    },
    appCount: apps?.n ?? 0,
    provider: api ? "whop" : null,
    subscription: toSubscription(ctx, owner, access.role === "owner"),
    purchasable: purchasableIntervals(api ? whopPlanIds(ctx.env) : {}),
  };
  return json(body);
}

/** Why the owner cannot buy the plan they already pay for, and where to go instead. */
function samePlanError(owner: AccountRow): HttpError | null {
  const name = getPlan(owner.plan).name;
  const interval = owner.billing_interval === "year" ? "yearly" : "monthly";
  switch (owner.billing_status) {
    case "active":
      return new HttpError(409, "already_on_plan", `Your account is already on ${name}, billed ${interval}.`);
    case "canceling":
      return new HttpError(
        409,
        "already_on_plan",
        `Your ${name} subscription is cancelled at the end of the period. To keep it, resume it in Manage subscription.`,
      );
    case "past_due":
      return new HttpError(
        409,
        "already_on_plan",
        `The last ${name} payment failed. Update the payment method in Manage subscription.`,
      );
    default:
      return null;
  }
}

/**
 * `POST /api/billing/checkout { plan, interval? }` (owner only) → `{ url }`: Whop's hosted
 * checkout for the plan. The metadata names the account; the webhook checks it against the
 * variant that was paid for. A change between paid plans is a new checkout: when it is paid, the
 * old membership is cancelled at the end of its period (Whop does not prorate).
 */
export async function startCheckout(ctx: AuthedContext): Promise<Response> {
  const { owner: stored } = await requireTeamAccess(ctx, "change_plan");
  const body = await readJsonObject(ctx.request);
  const plan = parsePaidPlan(body.plan);
  const interval = parseBillingInterval(body.interval, plan);
  const api = whopApi(ctx.env);
  const whopPlanId = api ? whopPlanIdFor(whopPlanIds(ctx.env), plan, interval) : undefined;
  if (!api || !whopPlanId) {
    throw new HttpError(503, "billing_unavailable", "This plan cannot be bought on this server yet.");
  }
  const owner = await currentBilling(ctx.env.DB, stored, ctx.deps.now());
  if (owner.plan === plan && owner.billing_interval === interval) {
    const error = samePlanError(owner);
    if (error) throw error;
  }

  try {
    const url = await createCheckout(ctx.deps.fetch, api, {
      whopPlanId,
      metadata: { accountId: owner.id, plan, interval, env: billingEnvironment(ctx.env) },
      redirectUrl: `${ctx.url.origin}/billing?checkout=success`,
    });
    const response: CheckoutResponse = { url };
    return json(response);
  } catch (error) {
    if (!(error instanceof WhopApiError)) throw error;
    console.error(JSON.stringify({ level: "error", event: "whop_checkout_failed", status: error.status }));
    throw new HttpError(502, "checkout_failed", "Whop did not start the checkout. Try again in a minute.");
  }
}

/**
 * Account deletion: the account's membership rows go, and a membership that still renews becomes
 * an anonymous retired row, so it is cancelled at period end until Whop confirms and never gives
 * a plan again. Runs right after the account rows are deleted; the cancel runs after the answer.
 */
export async function retireDeletedAccountBilling(ctx: AuthedContext, account: AccountRow): Promise<void> {
  const db = ctx.env.DB;
  const now = ctx.deps.now();
  const statements = [db.prepare("DELETE FROM whop_memberships WHERE account_id = ?").bind(account.id)];
  const membershipId = account.whop_membership_id;
  const status = account.billing_status;
  if (membershipId && (status === "active" || status === "past_due" || status === "canceling")) {
    statements.push(retireMembership(db, { id: membershipId, accountId: null, state: status, at: now }));
    // Already cancelled in Whop: nothing to send unless Whop reports that it renews again.
    if (status === "canceling") {
      statements.push(
        db
          .prepare("UPDATE whop_memberships SET cancel_confirmed_at = ? WHERE id = ?")
          .bind(now, membershipId),
      );
    }
  }
  await db.batch(statements);
  const cancel = cancelRetiredMemberships(ctx.env, ctx.deps);
  if (ctx.deps.waitUntil) ctx.deps.waitUntil(cancel);
  else await cancel;
}
