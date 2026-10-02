/**
 * Custom emoji rules shared by the dashboard and the API Worker (tenants API): shortcodes,
 * aliases, plan gates, R2 keys and the JSON shape. Storage lives in custom-emoji-store.ts.
 */
import { normalize } from "emojisense";
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
  source: CustomEmojiSource;
  bytes: number;
  createdAt: number;
}

export const SHORTCODE_MAX_LENGTH = 64;
export const MAX_ALIASES = 20;

const SHORTCODE = /^[a-z0-9_+-]{1,64}$/;

export type CustomEmojiInputField = "shortcode" | "aliases";

/** A rejected shortcode or alias list (HTTP 400 in both Workers). */
export class CustomEmojiInputError extends Error {
  readonly code = "invalid_request";
  readonly status = 400;
  constructor(
    readonly field: CustomEmojiInputField,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `":Party_Parrot:"` → `"party_parrot"`. Surrounding colons and spaces are dropped and letters
 * are lowercased; anything else outside [a-z0-9_+-] is rejected, not rewritten.
 */
export function parseShortcode(value: unknown): string {
  if (typeof value !== "string") throw new CustomEmojiInputError("shortcode", "shortcode is required.");
  const shortcode = value
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  if (!SHORTCODE.test(shortcode)) {
    throw new CustomEmojiInputError(
      "shortcode",
      `shortcode can have 1–${SHORTCODE_MAX_LENGTH} characters: a–z, 0–9, "_", "+" and "-".`,
    );
  }
  if (normalize(shortcode) === "") {
    throw new CustomEmojiInputError("shortcode", "shortcode needs at least one letter or digit.");
  }
  return shortcode;
}

/**
 * Aliases from a comma-separated string (multipart forms) or a string array (JSON). Each alias
 * is normalized like a query; empty and repeated ones are dropped. Undefined, null and "" mean
 * no aliases.
 */
export function parseAliases(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  let raw: unknown[];
  if (typeof value === "string") raw = value.split(",");
  else if (Array.isArray(value)) raw = value;
  else {
    throw new CustomEmojiInputError("aliases", "aliases must be a comma-separated string or a string array.");
  }
  if (raw.some((alias) => typeof alias !== "string")) {
    throw new CustomEmojiInputError("aliases", "Every alias must be a string.");
  }
  const aliases = [...new Set((raw as string[]).map((alias) => normalize(alias)).filter(Boolean))];
  if (aliases.length > MAX_ALIASES) {
    throw new CustomEmojiInputError("aliases", `A custom emoji can have at most ${MAX_ALIASES} aliases.`);
  }
  return aliases;
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

export function toCustomEmoji(row: CustomEmojiRow, apiUrl: string): CustomEmoji {
  return {
    id: row.id,
    shortcode: row.shortcode,
    aliases: storedAliases(row.aliases),
    imageUrl: customEmojiImageUrl(apiUrl, row.app_id, row.id),
    tenantId: row.tenant_id === "" ? null : row.tenant_id,
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
