/**
 * Billing has no provider yet (docs/PRICING.md). An upgrade puts the account on the waitlist
 * for that plan and never charges. The plan changes only when billing launches.
 */
import { getPlan, isHigherPlan, METRICS, type Metric, periodOf } from "@emojisense/platform";
import type { BillingResponse, UpgradeResponse } from "../../shared/contract";
import { requireTeamAccess } from "../access";
import type { D1Database } from "../d1";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { finiteOrNull, measureUsage, toPlanSummary } from "../plans";
import { parseOptionalEmail, parsePaidPlan } from "../validate";

/** Plan the email is on the waitlist for; rows from before plans were recorded mean Pro. */
export async function readWaitlistPlan(db: D1Database, email: string | null): Promise<string | null> {
  if (!email) return null;
  const row = await db
    .prepare("SELECT plan FROM waitlist WHERE email = ?")
    .bind(email)
    .first<{ plan: string | null }>();
  return row ? (row.plan ?? "pro") : null;
}

/** `GET /api/billing[?owner=]` (owner or admin): the plan, this month's usage of all owned apps. */
export async function getBilling(ctx: AuthedContext): Promise<Response> {
  const { owner, plan } = await requireTeamAccess(ctx, "view_billing");
  const db = ctx.env.DB;
  const period = periodOf(ctx.deps.now());
  const [metered, stored, apps, waitlistPlan] = await Promise.all([
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
    readWaitlistPlan(db, owner.email),
  ]);
  const used = new Map(metered.results.map((row) => [row.metric, row.count]));
  // Custom emoji are a stored count, not a monthly counter.
  used.set("custom_emoji", stored?.n ?? 0);

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
    provider: null,
    waitlistPlan,
  };
  return json(body);
}

/**
 * `POST /api/billing/upgrade { plan, email? }` (owner only). Records the account on the waitlist
 * for a higher plan. `email` is used only when the account has none (GitHub may not share one).
 */
export async function requestUpgrade(ctx: AuthedContext): Promise<Response> {
  const { owner } = await requireTeamAccess(ctx, "change_plan");
  const body = await readJsonObject(ctx.request);
  const plan = parsePaidPlan(body.plan);
  const current = getPlan(owner.plan);
  if (!isHigherPlan(plan, current.id)) {
    throw new HttpError(
      409,
      "plan_not_higher",
      `Your account is already on ${current.name}. Choose a higher plan.`,
      "plan",
    );
  }
  const email = owner.email ?? parseOptionalEmail(body.email);
  if (!email) {
    throw new HttpError(
      400,
      "invalid_request",
      "Your account has no email. Send one so we can tell you when the plan opens.",
      "email",
    );
  }
  await ctx.env.DB.prepare(
    `INSERT INTO waitlist (email, plan, created_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET plan = excluded.plan`,
  )
    .bind(email, plan, ctx.deps.now())
    .run();
  const response: UpgradeResponse = { status: "waitlist", plan };
  return json(response);
}
