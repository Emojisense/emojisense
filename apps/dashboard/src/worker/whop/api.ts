/**
 * The two Whop API calls the Worker makes: create a checkout for a plan, and cancel a membership
 * that a newer plan replaced. The key never leaves the Authorization header and is never logged.
 */
import type { Deps } from "../env";
import type { WhopApi } from "./config";

const TIMEOUT_MS = 10_000;

/** A failed Whop call. `status` is Whop's HTTP status; 0 = network error, timeout or bad answer. */
export class WhopApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`Whop ${operation} failed (${status || "no answer"})`);
  }
}

async function call(
  fetch: Deps["fetch"],
  api: WhopApi,
  operation: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${api.base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${api.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WhopApiError(operation, 0);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new WhopApiError(operation, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new WhopApiError(operation, 0);
  }
}

/** Only Whop's own https pages may receive the browser: never a URL from anywhere else. */
function checkoutUrl(api: WhopApi, value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  let url: URL;
  try {
    url = new URL(value, api.webOrigin);
  } catch {
    return null;
  }
  const host = url.hostname;
  return url.protocol === "https:" && (host === "whop.com" || host.endsWith(".whop.com")) ? url.href : null;
}

export interface CheckoutInput {
  whopPlanId: string;
  metadata: Record<string, string>;
  redirectUrl: string;
}

/** `POST /checkout_configurations` with an existing variant. Returns Whop's `purchase_url`. */
export async function createCheckout(
  fetch: Deps["fetch"],
  api: WhopApi,
  input: CheckoutInput,
): Promise<string> {
  const answer = await call(fetch, api, "checkout", "/checkout_configurations", {
    mode: "payment",
    plan_id: input.whopPlanId,
    metadata: input.metadata,
    redirect_url: input.redirectUrl,
  });
  const url = checkoutUrl(api, (answer as { purchase_url?: unknown } | null)?.purchase_url);
  if (!url) throw new WhopApiError("checkout", 0);
  return url;
}

/**
 * Stops a membership from renewing; it ends with its paid period (`cancel_at_period_end`). Used
 * when a new plan replaced it, and when the account is deleted. Retries are safe: the same
 * idempotency key cancels once.
 */
export async function cancelMembership(
  fetch: Deps["fetch"],
  api: WhopApi,
  membershipId: string,
  reason: string,
): Promise<void> {
  await call(
    fetch,
    api,
    "cancel",
    `/memberships/${encodeURIComponent(membershipId)}/cancel`,
    { cancel_at_period_end: true, reason },
    { "idempotency-key": `emojisense-cancel-${membershipId}` },
  );
}
