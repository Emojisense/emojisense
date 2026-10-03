import {
  type BillingInterval,
  billingIntervalsOf,
  EMOJI_SETS,
  type EmojiSet,
  getPlan,
  isBillingInterval,
  isPaidPlan,
  type KeyKind,
  PAID_PLAN_IDS,
  type PaidPlanId,
  type PlanId,
  periodOf,
  TEAM_ROLES,
  type TeamRole,
} from "@emojisense/platform";
import { ENVIRONMENTS, type Environment } from "../shared/contract";
import { HttpError } from "./http";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_CHARS = /\p{Cc}/u;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]{2,}$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MAX_APP_NAME = 64;

function invalid(field: string, message: string): HttpError {
  return new HttpError(400, "invalid_request", message, field);
}

export function isValidId(id: string | undefined): id is string {
  return id !== undefined && ID_PATTERN.test(id);
}

export function parseAppName(value: unknown): string {
  if (typeof value !== "string") throw invalid("name", "name is required.");
  const name = value.trim();
  if (name.length === 0) throw invalid("name", "name cannot be empty.");
  if (name.length > MAX_APP_NAME) throw invalid("name", `name can have at most ${MAX_APP_NAME} characters.`);
  if (CONTROL_CHARS.test(name)) throw invalid("name", "name cannot contain control characters.");
  return name;
}

/** A key's environment. Defaults to "prod", the column default in migrations/0010. */
export function parseEnvironment(value: unknown): Environment {
  if (value === undefined) return "prod";
  if (typeof value === "string" && (ENVIRONMENTS as readonly string[]).includes(value)) {
    return value as Environment;
  }
  throw invalid("environment", `environment must be one of: ${ENVIRONMENTS.join(", ")}.`);
}

export function parseKeyKind(value: unknown): KeyKind {
  if (value === "publishable" || value === "secret") return value;
  throw invalid("kind", 'kind must be "publishable" or "secret".');
}

/** `YYYY-MM` (UTC). Defaults to the current period; future periods have no usage yet. */
export function parsePeriod(value: string | null, now: number): string {
  const current = periodOf(now);
  if (value === null || value === "") return current;
  if (!PERIOD_PATTERN.test(value)) throw invalid("period", "period must look like 2026-10 (YYYY-MM).");
  if (value > current) throw invalid("period", `period cannot be later than the current period, ${current}.`);
  return value;
}

export function parseEmail(value: unknown): string {
  if (typeof value !== "string") throw invalid("email", "email is required.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw invalid("email", "Enter a valid email address, like name@example.com.");
  }
  return email;
}

/** `undefined`, `null` and "" mean "no email"; anything else must be valid. */
export function parseOptionalEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseEmail(value);
}

/** Defaults to "pro": the website's waitlist form asks for Pro. */
export function parseWaitlistPlan(value: unknown): PlanId {
  if (value === undefined) return "pro";
  return parsePaidPlan(value);
}

export function parsePaidPlan(value: unknown): PaidPlanId {
  if (isPaidPlan(value)) return value;
  throw invalid("plan", `plan must be one of: ${PAID_PLAN_IDS.join(", ")}.`);
}

/** Defaults to "month". "year" only where the plan is sold yearly (Solo). */
export function parseBillingInterval(value: unknown, plan: PlanId): BillingInterval {
  const interval = value === undefined ? "month" : value;
  if (!isBillingInterval(interval)) throw invalid("interval", 'interval must be "month" or "year".');
  if (!billingIntervalsOf(plan).includes(interval)) {
    throw invalid("interval", `The ${getPlan(plan).name} plan is billed monthly only.`);
  }
  return interval;
}

export function parseTeamRole(value: unknown): TeamRole {
  if (typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value)) {
    return value as TeamRole;
  }
  throw invalid("role", `role must be one of: ${TEAM_ROLES.join(", ")}.`);
}

export function parseEmojiSet(value: unknown): EmojiSet {
  if (typeof value === "string" && (EMOJI_SETS as readonly string[]).includes(value)) {
    return value as EmojiSet;
  }
  throw invalid("emojiSet", `emojiSet must be one of: ${EMOJI_SETS.join(", ")}.`);
}
