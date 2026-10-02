/**
 * A plan picked on the website: `/billing?plan=pro&interval=month`. Sign-in may leave the page
 * (Clerk goes to `/` afterwards, social sign-in leaves the site), so the pick waits in
 * sessionStorage, like a pending invite, and the app returns to Billing with it.
 */
import {
  type BillingInterval,
  billingIntervalsOf,
  isBillingInterval,
  isPaidPlan,
  type PaidPlanId,
} from "@emojisense/platform";

export interface CheckoutIntent {
  plan: PaidPlanId;
  interval: BillingInterval;
}

const KEY = "emojisense:checkout";

/** The pick in a query string; `null` without a paid plan. A missing or unsold interval is monthly. */
export function parseCheckoutIntent(search: URLSearchParams | string): CheckoutIntent | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const plan = params.get("plan");
  if (!isPaidPlan(plan)) return null;
  const interval = params.get("interval");
  return {
    plan,
    interval: isBillingInterval(interval) && billingIntervalsOf(plan).includes(interval) ? interval : "month",
  };
}

export function checkoutIntentQuery(intent: CheckoutIntent): string {
  return new URLSearchParams({ plan: intent.plan, interval: intent.interval }).toString();
}

export function rememberCheckoutIntent(intent: CheckoutIntent): void {
  try {
    sessionStorage.setItem(KEY, checkoutIntentQuery(intent));
  } catch {
    // Storage blocked: the person picks the plan again on the Billing page.
  }
}

export function pendingCheckoutIntent(): CheckoutIntent | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    return stored ? parseCheckoutIntent(stored) : null;
  } catch {
    return null;
  }
}

export function forgetCheckoutIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
