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

/** Returns a message for the person, or `undefined` when the address looks usable. */
export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (value === "") return "Enter your email address.";
  if (value.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(value)) {
    return "Enter a valid email address, like name@example.com.";
  }
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
}

const MESSAGES: Record<Exclude<WaitlistFailure, "invalid">, string> = {
  rate_limited: "Too many tries from this network. Wait a minute, then try again.",
  server: "The waitlist is not available right now. Try again in a few minutes.",
  network: "We could not reach the waitlist. Check your connection, then try again.",
};

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
  const invalid = validateEmail(email);
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
    return { ok: false, reason: "network", message: MESSAGES.network };
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
      message: "The waitlist did not accept this address. Check it, then try again.",
    };
  }
  if (response.status === 429) return { ok: false, reason: "rate_limited", message: MESSAGES.rate_limited };
  return { ok: false, reason: "server", message: MESSAGES.server };
}
