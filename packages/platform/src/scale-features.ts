import type { D1DatabaseLike } from "./d1-like.js";
import { getPlan, lowestPlanWith, type Plan, type PlanId } from "./plans.js";

export type ScaleFeature = "tenants" | "webhooks";

/**
 * Tenants and webhooks are one feature group of the Scale plan (docs/PRICING.md), so both read
 * the `tenants` flag. Give webhooks their own flag here if the plans ever split them.
 */
export function planAllows(plan: Plan, feature: ScaleFeature): boolean {
  switch (feature) {
    case "tenants":
    case "webhooks":
      return plan.tenants;
  }
}

/** The `plan` of a `402 plan_required` answer for `feature`. */
export function lowestPlanFor(feature: ScaleFeature): PlanId {
  return lowestPlanWith((plan) => planAllows(plan, feature)) ?? "scale";
}

export function planRequiredMessage(feature: ScaleFeature): string {
  const plan = getPlan(lowestPlanFor(feature));
  const name = feature === "tenants" ? "Tenants" : "Webhooks";
  return `${name} are part of the ${plan.name} plan. Upgrade the account that owns this app to use them.`;
}

/** An app with the account that owns it. The plan lives on the account; apps inherit it. */
export interface AppOwner {
  appId: string;
  accountId: string;
  plan: Plan;
}

export async function loadAppOwner(db: D1DatabaseLike, appId: string): Promise<AppOwner | undefined> {
  const row = await db
    .prepare(
      `SELECT a.id, a.account_id, ac.plan FROM apps a JOIN accounts ac ON ac.id = a.account_id
       WHERE a.id = ?`,
    )
    .bind(appId)
    .first<{ id: string; account_id: string; plan: string }>();
  return row ? { appId: row.id, accountId: row.account_id, plan: getPlan(row.plan) } : undefined;
}
