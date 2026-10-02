/**
 * Whop settings from the Worker's vars and secrets (README, "Payments"). Without them the
 * dashboard still runs: checkout answers 503 and the webhook refuses deliveries until set up.
 */
import { parseWhopPlanIds, type WhopPlanIds } from "@emojisense/platform";
import type { Env } from "../env";

export const DEFAULT_WHOP_API_BASE = "https://api.whop.com/api/v1";

export interface WhopApi {
  /** E.g. https://api.whop.com/api/v1, no trailing slash. */
  base: string;
  /** The checkout and billing pages: https://whop.com, or https://sandbox.whop.com. */
  webOrigin: string;
  apiKey: string;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The Whop site that belongs to an API base: the sandbox API serves sandbox.whop.com. */
export function whopWebOrigin(apiBase: string): string {
  const host = URL.canParse(apiBase) ? new URL(apiBase).hostname : "";
  return host.startsWith("sandbox-api.") || host.startsWith("sandbox.")
    ? "https://sandbox.whop.com"
    : "https://whop.com";
}

/** The API with its key, or `null` when WHOP_API_KEY is not set. */
export function whopApi(env: Env): WhopApi | null {
  if (!env.WHOP_API_KEY) return null;
  const base = trimSlash(env.WHOP_API_BASE?.trim() || DEFAULT_WHOP_API_BASE);
  return { base, webOrigin: whopWebOrigin(base), apiKey: env.WHOP_API_KEY };
}

/**
 * WHOP_PLAN_IDS. A malformed value is logged and sells nothing, so a typo can never sell or
 * grant the wrong plan.
 */
export function whopPlanIds(env: Env): WhopPlanIds {
  const ids = parseWhopPlanIds(env.WHOP_PLAN_IDS);
  if (ids) return ids;
  console.error(JSON.stringify({ level: "error", event: "whop_plan_ids_invalid" }));
  return {};
}

/**
 * The label in checkout metadata (`env`). Dev and production may sell through one Whop company,
 * and then both webhooks receive every event: each Worker applies only its own.
 */
export function billingEnvironment(env: Env): string {
  return env.ENVIRONMENT || "production";
}

/** Where a buyer manages Whop subscriptions when Whop sent no link for the membership. */
export function whopOrdersUrl(env: Env): string {
  const base = trimSlash(env.WHOP_API_BASE?.trim() || DEFAULT_WHOP_API_BASE);
  return `${whopWebOrigin(base)}/@me/settings/orders/`;
}
