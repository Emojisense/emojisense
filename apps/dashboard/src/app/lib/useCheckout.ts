import type { BillingInterval, PaidPlanId } from "@emojisense/platform";
import { useState } from "react";
import { api, errorMessage } from "../api";

/** Leaves the dashboard for Whop's checkout page. Tests replace `assign`. */
export const browser = {
  assign: (url: string) => window.location.assign(url),
};

const STARTED_KEY = "emojisense:checkout-started";

/** The plan sent to Whop, so the return page knows which plan to wait for. */
export function startedCheckout(): { plan: PaidPlanId; interval: BillingInterval } | null {
  try {
    const stored = sessionStorage.getItem(STARTED_KEY);
    return stored ? (JSON.parse(stored) as { plan: PaidPlanId; interval: BillingInterval }) : null;
  } catch {
    return null;
  }
}

export function forgetStartedCheckout(): void {
  try {
    sessionStorage.removeItem(STARTED_KEY);
  } catch {
    // Nothing to clean up.
  }
}

export const checkoutKey = (plan: PaidPlanId, interval: BillingInterval) => `${plan}:${interval}`;

/**
 * "Upgrade" asks the Worker for a Whop checkout and goes there. The plan changes only when Whop's
 * webhook confirms the payment; Whop then sends the person back to `/billing?checkout=success`.
 */
export function useCheckout() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  async function start(plan: PaidPlanId, interval: BillingInterval) {
    const key = checkoutKey(plan, interval);
    setPending(key);
    setError(null);
    try {
      const { url } = await api.checkout(plan, interval);
      try {
        sessionStorage.setItem(STARTED_KEY, JSON.stringify({ plan, interval }));
      } catch {
        // The return page then waits for any active plan.
      }
      browser.assign(url);
    } catch (caught) {
      setError({ key, message: errorMessage(caught) });
      setPending(null);
    }
  }

  return { start, pending, error };
}
