/**
 * What every custom emoji route shares besides the access gate (access.ts): the plan limit
 * error, the R2 binding, the image URL base, the mapping of platform validation results, and the
 * custom_emoji.* webhook events.
 */
import {
  type CustomEmoji,
  type EmojiBucket,
  type EmojiImage,
  emitWebhookEvent,
  inspectEmojiImage,
  lowestPlanWith,
  type Parsed,
  PLANS,
  type Plan,
} from "@emojisense/platform";
import type { Env, RequestContext } from "./env";
import { HttpError, planRequired } from "./http";
import { webhookRuntime } from "./webhook-runtime";

/** Production API origin; `API_URL` overrides it (wrangler vars, .dev.vars). */
export const DEFAULT_API_URL = "https://api.emojisense.com";

const count = (n: number) => n.toLocaleString("en-US");

/**
 * The account is at its plan's custom emoji limit (every emoji of every app counts):
 * `402 plan_required` naming the cheapest plan with a higher limit, or `403 plan_limit` on the
 * top plan.
 */
export function limitReached(plan: Plan): HttpError {
  const limit = plan.limits.custom_emoji;
  const next = lowestPlanWith((p) => p.limits.custom_emoji > limit);
  const base = `Your ${plan.name} plan allows ${count(limit)} custom emoji across all apps of the account, and all are used.`;
  if (!next) return new HttpError(403, "plan_limit", `${base} Delete some to add new ones.`);
  return planRequired(next, `${base} ${PLANS[next].name} allows ${count(PLANS[next].limits.custom_emoji)}.`);
}

/** A platform parse result, or `400 invalid_request` with its field. */
export function valid<T>(parsed: Parsed<T>): T {
  if (parsed.ok) return parsed.value;
  throw new HttpError(400, "invalid_request", parsed.message, parsed.field);
}

/** The image with its real type, or the platform's refusal (400, 413 or 415) with field `file`. */
export function checkedImage(bytes: Uint8Array): EmojiImage {
  const checked = inspectEmojiImage(bytes);
  if (checked.ok) return checked.image;
  throw new HttpError(checked.status, checked.error, checked.message, checked.field);
}

/** Sends `custom_emoji.created` or `custom_emoji.deleted` to the app's webhooks (Scale), in the background. */
export function emitEmojiEvent(
  ctx: RequestContext,
  type: "custom_emoji.created" | "custom_emoji.deleted",
  appId: string,
  emoji: CustomEmoji,
): void {
  emitWebhookEvent(webhookRuntime(ctx), { type, appId, data: emoji });
}

export function shortcodeTaken(shortcode: string): HttpError {
  return new HttpError(409, "shortcode_taken", `:${shortcode}: already exists in this app.`, "shortcode");
}

export function requireBucket(env: Env): EmojiBucket {
  if (!env.EMOJI) {
    throw new HttpError(
      503,
      "storage_unavailable",
      "Custom emoji storage is not configured. Try again later.",
    );
  }
  return env.EMOJI;
}

export function apiUrlOf(env: Env): string {
  return env.API_URL || DEFAULT_API_URL;
}

/** JSON has no Infinity, so "unlimited" is `null`. */
export function limitOf(plan: Plan): number | null {
  const limit = plan.limits.custom_emoji;
  return Number.isFinite(limit) ? limit : null;
}

/**
 * Reads at most `max` bytes of a body; undefined when it is larger. Stops at the limit, so an
 * oversized upload or download costs no more memory than the limit.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
