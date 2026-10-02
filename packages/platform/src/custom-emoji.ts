/**
 * Custom emoji rules shared by the dashboard (uploads, imports) and the API Worker (tenants API):
 * shortcodes, aliases, plan gates, R2 keys and the JSON shape. Storage lives in
 * custom-emoji-store.ts, image checks in emoji-image.ts.
 */
import { normalize } from "emojisense";
import type { Parsed } from "./d1-like.js";
import { isHigherPlan, type Plan, type PlanId } from "./plans.js";
import type { CustomEmojiRow, CustomEmojiSource } from "./types.js";

/** The JSON shape of a custom emoji in the dashboard API and the tenants API. */
export interface CustomEmoji {
  id: string;
  /** Without colons, e.g. "party_parrot". */
  shortcode: string;
  /** Normalized search phrases (PACK_FORMAT.md §3). */
  aliases: string[];
  /** `${API_URL}/v1/custom/<appId>/<emojiId>`, served by the API Worker (immutable). */
  imageUrl: string;
  /** `tenants.id` of the owning tenant; null = app-wide. */
  tenantId: string | null;
  /** The tenant's id in the owner's system, where the caller knows it (tenants API, webhooks). */
  tenantExternalId?: string | null;
  source: CustomEmojiSource;
  bytes: number;
  createdAt: number;
}

export const SHORTCODE_MAX_LENGTH = 64;
export const MAX_ALIASES = 20;

const SHORTCODE = /^[a-z0-9_+-]{1,64}$/;

/**
 * `":Party_Parrot:"` → `"party_parrot"`. Surrounding colons and spaces are dropped and letters
 * are lowercased; anything else outside [a-z0-9_+-] is refused, not rewritten.
 */
export function parseShortcode(value: unknown): Parsed<string> {
  const invalid = (message: string) => ({ ok: false as const, field: "shortcode", message });
  if (typeof value !== "string" || value.trim() === "") return invalid("shortcode is required.");
  const shortcode = value
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  if (!SHORTCODE.test(shortcode)) {
    return invalid(`shortcode can have 1–${SHORTCODE_MAX_LENGTH} characters: a–z, 0–9, "_", "+" and "-".`);
  }
  if (normalize(shortcode) === "") return invalid("shortcode needs at least one letter or digit.");
  return { ok: true, value: shortcode };
}

/**
 * Aliases from a comma-separated string (multipart forms) or a string array (JSON). Each alias
 * is normalized like a query (so it is at most 64 characters); empty and repeated ones are
 * dropped. Undefined, null and "" mean no aliases.
 */
export function parseAliases(value: unknown): Parsed<string[]> {
  const invalid = (message: string) => ({ ok: false as const, field: "aliases", message });
  if (value === undefined || value === null || value === "") return { ok: true, value: [] };
  let raw: unknown[];
  if (typeof value === "string") raw = value.split(",");
  else if (Array.isArray(value)) raw = value;
  else return invalid("aliases must be a comma-separated string or a string array.");
  if (raw.some((alias) => typeof alias !== "string")) return invalid("Every alias must be a string.");
  const aliases = [...new Set((raw as string[]).map((alias) => normalize(alias)).filter(Boolean))];
  if (aliases.length > MAX_ALIASES) return invalid(`A custom emoji can have at most ${MAX_ALIASES} aliases.`);
  return { ok: true, value: aliases };
}

/** `custom_emoji.aliases` is JSON; a corrupt value reads as no aliases. */
export function storedAliases(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((alias): alias is string => typeof alias === "string") : [];
  } catch {
    return [];
  }
}

/** R2 key (CONTRACT: `custom/<appId>/<tenantId or "_">/<emojiId>.<ext>`). */
export function customEmojiImageKey(
  appId: string,
  tenantId: string | null,
  emojiId: string,
  extension: string,
): string {
  return `custom/${appId}/${tenantId || "_"}/${emojiId}.${extension}`;
}

/** The public, immutable image URL on the API Worker. */
export function customEmojiImageUrl(apiUrl: string, appId: string, emojiId: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/v1/custom/${encodeURIComponent(appId)}/${encodeURIComponent(emojiId)}`;
}

/** `tenantExternalId` is added only when given (undefined leaves the key out). */
export function toCustomEmoji(
  row: CustomEmojiRow,
  apiUrl: string,
  tenantExternalId?: string | null,
): CustomEmoji {
  return {
    id: row.id,
    shortcode: row.shortcode,
    aliases: storedAliases(row.aliases),
    imageUrl: customEmojiImageUrl(apiUrl, row.app_id, row.id),
    tenantId: row.tenant_id === "" ? null : row.tenant_id,
    ...(tenantExternalId === undefined ? {} : { tenantExternalId }),
    source: row.source,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/** Plans with a custom emoji limit above zero may upload custom emoji. */
export function hasCustomEmoji(plan: Plan): boolean {
  return plan.limits.custom_emoji > 0;
}

/** Slack and Discord imports start at Pro (docs/PRICING.md). */
export const EMOJI_IMPORT_MIN_PLAN: PlanId = "pro";

export function hasEmojiImport(plan: Plan): boolean {
  return hasCustomEmoji(plan) && !isHigherPlan(EMOJI_IMPORT_MIN_PLAN, plan.id);
}
