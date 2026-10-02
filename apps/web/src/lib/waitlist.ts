import type { PlanId } from "@emojisense/platform";

/** Plans people can wait for. Free needs no waitlist: it is open now. */
export type WaitlistPlan = Exclude<PlanId, "free">;
export const WAITLIST_PLANS: readonly WaitlistPlan[] = ["solo", "pro", "scale"];
export const DEFAULT_WAITLIST_PLAN: WaitlistPlan = "pro";

/** Longest address SMTP allows (RFC 5321 path limit minus the angle brackets). */
const MAX_EMAIL_LENGTH = 254;
/** Deliberately loose: one "@", no spaces, a dot in the domain. The server decides the rest. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TIMEOUT_MS = 10_000;

export function parsePlan(value: string | null | undefined): WaitlistPlan {
  return WAITLIST_PLANS.find((plan) => plan === value) ?? DEFAULT_WAITLIST_PLAN;
}

/**
 * What the form says when something goes wrong. A translated page passes its own (the catalog's
 * `waitlist.errors`); these English ones are the same words as the English catalog.
 */
export interface WaitlistErrors {
  empty: string;
  invalid: string;
  rejected: string;
  rateLimited: string;
  server: string;
  network: string;
}

export const ENGLISH_ERRORS: WaitlistErrors = {
  empty: "Enter your email address.",
  invalid: "Enter a valid email address, like name@example.com.",
  rejected: "The waitlist did not accept this address. Check it, then try again.",
  rateLimited: "Too many tries from this network. Wait a minute, then try again.",
  server: "The waitlist is not available right now. Try again in a few minutes.",
  network: "We could not reach the waitlist. Check your connection, then try again.",
};

/** Returns a message for the person, or `undefined` when the address looks usable. */
export function validateEmail(email: string, errors: WaitlistErrors = ENGLISH_ERRORS): string | undefined {
  const value = email.trim();
  if (value === "") return errors.empty;
  if (value.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(value)) return errors.invalid;
  return undefined;
}

export type WaitlistFailure = "invalid" | "rate_limited" | "server" | "network";

export type WaitlistResult =
  | { ok: true; alreadyJoined: boolean }
  | { ok: false; reason: WaitlistFailure; message: string };

export interface SubmitWaitlistOptions {
  /** Dashboard endpoint, e.g. "https://dashboard.emojisense.com/api/waitlist". */
  endpoint: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The messages in the page's language. */
  errors?: WaitlistErrors;
}

/**
 * What the page says after a form post that the browser sent without JavaScript. The dashboard
 * answers it with a redirect to `/waitlist/?status=ok|error` (docs/API.md, `POST /api/waitlist`).
 */
export const RETURN_MESSAGES = {
  ok: { title: "You are on the list", text: "We will email you once, when your plan opens." },
  error: {
    title: "We could not add you",
    text: "Check your email address, wait a minute, then send the form again.",
  },
} as const;

/**
 * POST `{ email, plan }` to the dashboard (docs/API.md, `POST /api/waitlist`). Never throws:
 * every outcome maps to a result the form can show inline.
 */
export async function submitWaitlist(
  input: { email: string; plan: WaitlistPlan },
  options: SubmitWaitlistOptions,
): Promise<WaitlistResult> {
  const email = input.email.trim();
  const errors = options.errors ?? ENGLISH_ERRORS;
  const invalid = validateEmail(email, errors);
  if (invalid) return { ok: false, reason: "invalid", message: invalid };

  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, plan: input.plan }),
      credentials: "omit",
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: "network", message: errors.network };
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return { ok: true, alreadyJoined: false };
  // Joining twice is not an error for the person: they are on the list either way.
  if (response.status === 409) return { ok: true, alreadyJoined: true };
  if (response.status === 400 || response.status === 422) {
    return {
      ok: false,
      reason: "invalid",
      message: errors.rejected,
    };
  }
  if (response.status === 429) return { ok: false, reason: "rate_limited", message: errors.rateLimited };
  return { ok: false, reason: "server", message: errors.server };
}
