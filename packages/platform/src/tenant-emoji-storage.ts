/**
 * Custom emoji storage used by the tenants API: D1 rows in `custom_emoji` plus images in the R2
 * bucket `EMOJI` (key `custom/<appId>/<tenantId or "_">/<emojiId>.<ext>`).
 *
 * MERGE NOTE: the custom-emoji work builds the same storage for the dashboard upload, the Slack and
 * Discord imports and the image route. This module keeps the surface small on purpose
 * (`putCustomEmoji`, `deleteCustomEmoji`, `listCustomEmoji`, all with `tenantId`), so it can be
 * replaced by, or folded into, that implementation without touching the tenants routes.
 */
import type { D1DatabaseLike, Parsed } from "./d1-like.js";
import { randomId } from "./keys.js";
import type { CustomEmojiContentType, CustomEmojiRow, CustomEmojiSource } from "./types.js";

export const MAX_EMOJI_BYTES = 256 * 1024;
export const MAX_ALIASES = 20;
export const MAX_ALIAS_LENGTH = 64;
const SHORTCODE = /^[a-z0-9_+-]{1,64}$/;

/** The R2 calls this module makes; the real binding fits structurally. */
export interface EmojiBucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

/** The JSON shape of a custom emoji (CONTRACT.md `CustomEmoji`), plus the tenant's external id. */
export interface CustomEmoji {
  id: string;
  shortcode: string;
  aliases: string[];
  imageUrl: string;
  tenantId: string | null;
  tenantExternalId?: string | null;
  source: CustomEmojiSource;
  bytes: number;
  createdAt: number;
}

export function toCustomEmoji(
  row: CustomEmojiRow,
  apiUrl: string,
  tenantExternalId?: string | null,
): CustomEmoji {
  return {
    id: row.id,
    shortcode: row.shortcode,
    aliases: decodeAliases(row.aliases),
    imageUrl: `${apiUrl.replace(/\/+$/, "")}/v1/custom/${row.app_id}/${row.id}`,
    tenantId: row.tenant_id === "" ? null : row.tenant_id,
    ...(tenantExternalId === undefined ? {} : { tenantExternalId }),
    source: row.source,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

function decodeAliases(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// --- Validation -------------------------------------------------------------------------------

/** Accepts `party_parrot` or `:party_parrot:`; stores it lowercase, without colons. */
export function parseShortcode(value: unknown): Parsed<string> {
  const invalid = (message: string) => ({ ok: false as const, field: "shortcode", message });
  if (typeof value !== "string" || value.trim() === "") return invalid("shortcode is required.");
  const shortcode = value.trim().replace(/^:|:$/g, "").toLowerCase();
  if (!SHORTCODE.test(shortcode)) {
    return invalid("shortcode must be 1–64 characters of a–z, 0–9, _, + or -.");
  }
  return { ok: true, value: shortcode };
}

/**
 * Comma-separated aliases. `normalize` is the search normalizer (PACK_FORMAT.md §3), passed in
 * because this package has no dependency on the core engine.
 */
export function parseAliases(
  value: unknown,
  normalize: (text: string) => string = (text) => text.trim().toLowerCase().replace(/\s+/g, " "),
): Parsed<string[]> {
  if (value === undefined || value === null || value === "") return { ok: true, value: [] };
  if (typeof value !== "string") return { ok: false, field: "aliases", message: "aliases must be text." };
  const aliases = [
    ...new Set(
      value
        .split(",")
        .map((alias) => normalize(alias))
        .filter(Boolean),
    ),
  ];
  if (aliases.length > MAX_ALIASES) {
    return { ok: false, field: "aliases", message: `aliases can have at most ${MAX_ALIASES} entries.` };
  }
  if (aliases.some((alias) => alias.length > MAX_ALIAS_LENGTH)) {
    return {
      ok: false,
      field: "aliases",
      message: `Each alias can have at most ${MAX_ALIAS_LENGTH} characters.`,
    };
  }
  return { ok: true, value: aliases };
}

export interface EmojiImage {
  bytes: Uint8Array;
  contentType: CustomEmojiContentType;
}

export type ImageCheck =
  | { ok: true; image: EmojiImage }
  | { ok: false; error: "image_too_large" | "unsupported_image" | "unsafe_svg"; message: string };

const EXTENSIONS: Record<CustomEmojiContentType, string> = {
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * The type comes from the file's own bytes, never from the declared type or the file name.
 * SVG is text that browsers can run as a page, so it must pass `checkSvg`.
 */
export function inspectEmojiImage(bytes: Uint8Array): ImageCheck {
  if (bytes.byteLength > MAX_EMOJI_BYTES) {
    return { ok: false, error: "image_too_large", message: "The image is larger than 256 KB." };
  }
  const startsWith = (signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, image: { bytes, contentType: "image/png" } };
  }
  if (startsWith(ascii("GIF87a")) || startsWith(ascii("GIF89a"))) {
    return { ok: true, image: { bytes, contentType: "image/gif" } };
  }
  if (startsWith(ascii("RIFF")) && startsWith(ascii("WEBP"), 8)) {
    return { ok: true, image: { bytes, contentType: "image/webp" } };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unsupported();
  }
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (!trimmed.startsWith("<") || !/<svg[\s>]/i.test(trimmed)) return unsupported();
  const problem = checkSvg(trimmed);
  if (problem) return { ok: false, error: "unsafe_svg", message: `The SVG was refused: ${problem}.` };
  return { ok: true, image: { bytes, contentType: "image/svg+xml" } };
}

function unsupported(): ImageCheck {
  return { ok: false, error: "unsupported_image", message: "Upload a PNG, GIF, WebP or SVG image." };
}

/**
 * CONTRACT.md: reject `<script`, `on*=` attributes, `javascript:` and external `href`s. Numeric
 * character references are decoded first, so `&#106;avascript:` is caught too. Also refused:
 * DOCTYPE/ENTITY (entity expansion), `<foreignObject>` (embedded HTML) and external CSS `url()`
 * or `@import`. Embedded raster images (`data:image/png|gif|webp|jpeg`) and `#fragment` links stay.
 */
export function checkSvg(svg: string): string | undefined {
  const text = svg
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => safeCodePoint(Number(dec)));
  if (/<script/i.test(text)) return "it contains a script";
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) return "it contains an event handler attribute (on…=)";
  if (/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i.test(text) || /vbscript\s*:/i.test(text)) {
    return "it contains a javascript: link";
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return "it contains a DOCTYPE or ENTITY declaration";
  if (/<foreignObject/i.test(text)) return "it contains a foreignObject";
  if (/@import/i.test(text)) return "it imports an external stylesheet";
  if (/url\(\s*(?!['"]?\s*#)/i.test(text)) return "it loads an external resource with url()";
  for (const match of text.matchAll(/(?:^|[\s"'/])(?:xlink:)?href\s*=\s*(["']?)([^"'\s>]*)\1/gi)) {
    const target = (match[2] ?? "").trim();
    if (target === "" || target.startsWith("#") || /^data:image\/(png|gif|webp|jpeg);/i.test(target))
      continue;
    return "it links to an external resource (href)";
  }
  return undefined;
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

// --- Storage ----------------------------------------------------------------------------------

export interface CustomEmojiScope {
  appId: string;
  /** Tenant id (tenants.id), or null for app-wide emoji. */
  tenantId: string | null;
}

export interface PutCustomEmojiInput extends CustomEmojiScope {
  /** The account that owns the app: the custom emoji limit counts all of its apps. */
  accountId: string;
  limit: number;
  shortcode: string;
  aliases: string[];
  image: EmojiImage;
  source: CustomEmojiSource;
}

export type PutCustomEmojiResult =
  | { ok: true; emoji: CustomEmojiRow }
  | { ok: false; error: "shortcode_taken" }
  | { ok: false; error: "limit_reached"; used: number; limit: number };

export interface CustomEmojiStorage {
  putCustomEmoji(input: PutCustomEmojiInput): Promise<PutCustomEmojiResult>;
  /** Removes the row and its image; undefined when no emoji has this shortcode in the scope. */
  deleteCustomEmoji(input: CustomEmojiScope & { shortcode: string }): Promise<CustomEmojiRow | undefined>;
  listCustomEmoji(input: CustomEmojiScope): Promise<CustomEmojiRow[]>;
  /** Custom emoji of every app of the account (what the plan's custom_emoji limit counts). */
  countAccountCustomEmoji(accountId: string): Promise<number>;
}

const COUNT_ACCOUNT = `SELECT COUNT(*) AS used FROM custom_emoji ce JOIN apps a ON a.id = ce.app_id
  WHERE a.account_id = ?`;

export function imageKey(
  appId: string,
  tenantId: string | null,
  emojiId: string,
  type: CustomEmojiContentType,
) {
  return `custom/${appId}/${tenantId ?? "_"}/${emojiId}.${EXTENSIONS[type]}`;
}

export function createCustomEmojiStorage(deps: {
  db: D1DatabaseLike;
  bucket: EmojiBucket;
  now: () => number;
}): CustomEmojiStorage {
  const { db, bucket, now } = deps;
  const tenantColumn = (tenantId: string | null) => tenantId ?? "";

  async function countAccountCustomEmoji(accountId: string): Promise<number> {
    const row = await db.prepare(COUNT_ACCOUNT).bind(accountId).first<{ used: number }>();
    return row?.used ?? 0;
  }

  async function findByShortcode(scope: CustomEmojiScope, shortcode: string) {
    return db
      .prepare("SELECT * FROM custom_emoji WHERE app_id = ? AND tenant_id = ? AND shortcode = ?")
      .bind(scope.appId, tenantColumn(scope.tenantId), shortcode)
      .first<CustomEmojiRow>();
  }

  return {
    countAccountCustomEmoji,

    async putCustomEmoji(input) {
      // Cheap checks first, so a duplicate or an upload over the limit costs no R2 write.
      if (await findByShortcode(input, input.shortcode)) return { ok: false, error: "shortcode_taken" };
      const usedBefore = await countAccountCustomEmoji(input.accountId);
      if (usedBefore >= input.limit) {
        return { ok: false, error: "limit_reached", used: usedBefore, limit: input.limit };
      }

      const row: CustomEmojiRow = {
        id: randomId(),
        app_id: input.appId,
        tenant_id: tenantColumn(input.tenantId),
        shortcode: input.shortcode,
        aliases: JSON.stringify(input.aliases),
        image_key: "",
        content_type: input.image.contentType,
        bytes: input.image.bytes.byteLength,
        source: input.source,
        created_at: now(),
      };
      row.image_key = imageKey(input.appId, input.tenantId, row.id, row.content_type);
      // The image goes first: a row must never point at a missing image. If the insert below
      // fails, the object is removed again.
      await bucket.put(row.image_key, input.image.bytes, {
        httpMetadata: { contentType: row.content_type },
      });
      try {
        // The limit is checked again inside the insert, so parallel uploads cannot pass it.
        const result = await db
          .prepare(
            `INSERT INTO custom_emoji
               (id, app_id, tenant_id, shortcode, aliases, image_key, content_type, bytes, source, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (${COUNT_ACCOUNT}) < ?`,
          )
          .bind(
            row.id,
            row.app_id,
            row.tenant_id,
            row.shortcode,
            row.aliases,
            row.image_key,
            row.content_type,
            row.bytes,
            row.source,
            row.created_at,
            input.accountId,
            input.limit,
          )
          .run();
        if (result.meta.changes === 0) {
          await bucket.delete(row.image_key);
          return { ok: false, error: "limit_reached", used: input.limit, limit: input.limit };
        }
      } catch (error) {
        await bucket.delete(row.image_key).catch(() => {});
        if (/UNIQUE/i.test((error as Error).message)) return { ok: false, error: "shortcode_taken" };
        throw error;
      }
      return { ok: true, emoji: row };
    },

    async deleteCustomEmoji(input) {
      const row = await findByShortcode(input, input.shortcode);
      if (!row) return undefined;
      await db.prepare("DELETE FROM custom_emoji WHERE id = ?").bind(row.id).run();
      await removeImages(bucket, [row.image_key]);
      return row;
    },

    async listCustomEmoji(input) {
      const { results } = await db
        .prepare("SELECT * FROM custom_emoji WHERE app_id = ? AND tenant_id = ? ORDER BY shortcode")
        .bind(input.appId, tenantColumn(input.tenantId))
        .all<CustomEmojiRow>();
      return results;
    },
  };
}

/** R2 deletes at most 1000 keys per call. A failure leaves orphan objects, never broken rows. */
export async function removeImages(bucket: EmojiBucket | undefined, keys: readonly string[]): Promise<void> {
  if (!bucket) return;
  try {
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
  } catch (error) {
    console.warn(JSON.stringify({ event: "emoji_image_delete_failed", error: (error as Error).name }));
  }
}
