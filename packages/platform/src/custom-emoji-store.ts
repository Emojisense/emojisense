/**
 * Custom emoji storage, the one implementation for every writer and reader: rows in D1
 * (`custom_emoji`), images in R2 (binding `EMOJI`). The dashboard uploads and imports, the API
 * Worker's tenants API writes tenant emoji, and the API Worker's search and pack routes read.
 *
 * `tenantId` arguments are `tenants.id` values; `null` means app-wide (stored as "").
 * The plan's custom_emoji limit counts every emoji of every app of the owning account.
 */
import { customEmojiImageKey } from "./custom-emoji.js";
import type { D1DatabaseLike, SqlValue } from "./d1-like.js";
import type { EmojiImage } from "./emoji-image.js";
import type { CustomEmojiRow, CustomEmojiSource } from "./types.js";

/** Enough of D1 to read. The API Worker's search path only reads. */
export interface SqlReader {
  prepare(sql: string): {
    bind(...values: SqlValue[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

/** The R2 writes custom emoji need; the real binding and the test fakes fit structurally. */
export interface EmojiBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

/** Images never change under one id (a new image is a new emoji), so caches may keep them. */
export const CUSTOM_EMOJI_CACHE_CONTROL = "public, max-age=31536000, immutable";

const tenantColumn = (tenantId: string | null) => tenantId ?? "";

const COUNT_ACCOUNT = `SELECT COUNT(*) FROM custom_emoji ce JOIN apps a ON a.id = ce.app_id
  WHERE a.account_id = ?`;

/** What the plan's custom_emoji limit counts: every emoji of every app of the account. */
export async function countAccountCustomEmoji(db: SqlReader, accountId: string): Promise<number> {
  const row = await db.prepare(`SELECT (${COUNT_ACCOUNT}) AS used`).bind(accountId).first<{ used: number }>();
  return row?.used ?? 0;
}

/**
 * `tenantId`: undefined = every emoji of the app, null = app-wide only, a string = that tenant's
 * only. `order`: "newest" (default, the dashboard) or "shortcode" (the tenants API).
 */
export async function listCustomEmoji(
  db: SqlReader,
  appId: string,
  options: { tenantId?: string | null; order?: "newest" | "shortcode" } = {},
): Promise<CustomEmojiRow[]> {
  const order = options.order === "shortcode" ? "shortcode, id" : "created_at DESC, id";
  const statement =
    options.tenantId === undefined
      ? db.prepare(`SELECT * FROM custom_emoji WHERE app_id = ? ORDER BY ${order}`).bind(appId)
      : db
          .prepare(`SELECT * FROM custom_emoji WHERE app_id = ? AND tenant_id = ? ORDER BY ${order}`)
          .bind(appId, tenantColumn(options.tenantId));
  return (await statement.all<CustomEmojiRow>()).results;
}

export async function findCustomEmoji(
  db: SqlReader,
  appId: string,
  emojiId: string,
): Promise<CustomEmojiRow | undefined> {
  const row = await db
    .prepare("SELECT * FROM custom_emoji WHERE id = ? AND app_id = ?")
    .bind(emojiId, appId)
    .first<CustomEmojiRow>();
  return row ?? undefined;
}

export async function findCustomEmojiByShortcode(
  db: SqlReader,
  appId: string,
  tenantId: string | null,
  shortcode: string,
): Promise<CustomEmojiRow | undefined> {
  const row = await db
    .prepare("SELECT * FROM custom_emoji WHERE app_id = ? AND tenant_id = ? AND shortcode = ?")
    .bind(appId, tenantColumn(tenantId), shortcode)
    .first<CustomEmojiRow>();
  return row ?? undefined;
}

/**
 * What one app (and optionally one tenant, by external id) can use: the app-wide emoji plus the
 * tenant's. A tenant emoji replaces an app-wide one with the same shortcode. Sorted by shortcode.
 */
export async function listUsableCustomEmoji(
  db: SqlReader,
  appId: string,
  tenantExternalId?: string,
): Promise<CustomEmojiRow[]> {
  const { results } = tenantExternalId
    ? await db
        .prepare(
          `SELECT * FROM custom_emoji WHERE app_id = ? AND (tenant_id = '' OR tenant_id =
             (SELECT id FROM tenants WHERE app_id = ? AND external_id = ?))
           ORDER BY shortcode, tenant_id DESC`,
        )
        .bind(appId, appId, tenantExternalId)
        .all<CustomEmojiRow>()
    : await db
        .prepare("SELECT * FROM custom_emoji WHERE app_id = ? AND tenant_id = '' ORDER BY shortcode")
        .bind(appId)
        .all<CustomEmojiRow>();
  // Rows of one shortcode are adjacent, tenant row first ("" sorts last in DESC order).
  return results.filter((row, i) => results[i - 1]?.shortcode !== row.shortcode);
}

export interface NewCustomEmoji {
  appId: string;
  /** The account that owns the app: the limit counts all of its apps. */
  accountId: string;
  tenantId: string | null;
  shortcode: string;
  aliases: string[];
  image: EmojiImage;
  source: CustomEmojiSource;
  /** The owner plan's custom_emoji limit. Infinity = unlimited. */
  limit: number;
  now: number;
  /** Random URL-safe id. */
  id: string;
}

export type CreateCustomEmojiResult =
  | { status: "created"; row: CustomEmojiRow }
  | { status: "shortcode_taken" }
  | { status: "limit_reached"; used: number; limit: number };

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed/i.test(error.message);

/**
 * Stores the image in R2, then inserts the row: a row never points at a missing image. The limit
 * check is part of the INSERT, so two parallel uploads cannot pass it together. On any refusal
 * the image is removed again.
 */
export async function createCustomEmoji(
  db: D1DatabaseLike,
  bucket: EmojiBucket,
  input: NewCustomEmoji,
): Promise<CreateCustomEmojiResult> {
  // Cheap checks first, so a duplicate or an upload over the limit costs no R2 write.
  if (await findCustomEmojiByShortcode(db, input.appId, input.tenantId, input.shortcode)) {
    return { status: "shortcode_taken" };
  }
  const limited = Number.isFinite(input.limit);
  if (limited) {
    const used = await countAccountCustomEmoji(db, input.accountId);
    if (used >= input.limit) return { status: "limit_reached", used, limit: input.limit };
  }

  const row: CustomEmojiRow = {
    id: input.id,
    app_id: input.appId,
    tenant_id: tenantColumn(input.tenantId),
    shortcode: input.shortcode,
    aliases: JSON.stringify(input.aliases),
    image_key: customEmojiImageKey(input.appId, input.tenantId, input.id, input.image.extension),
    content_type: input.image.contentType,
    bytes: input.image.bytes.byteLength,
    source: input.source,
    created_at: input.now,
  };
  await bucket.put(row.image_key, input.image.bytes, {
    httpMetadata: { contentType: row.content_type, cacheControl: CUSTOM_EMOJI_CACHE_CONTROL },
  });

  const columns =
    "id, app_id, tenant_id, shortcode, aliases, image_key, content_type, bytes, source, created_at";
  const values = [
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
  ];
  let changes: number;
  try {
    const insert = limited
      ? db
          .prepare(
            `INSERT INTO custom_emoji (${columns}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (${COUNT_ACCOUNT}) < ?`,
          )
          .bind(...values, input.accountId, input.limit)
      : db
          .prepare(`INSERT INTO custom_emoji (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(...values);
    changes = (await insert.run()).meta.changes;
  } catch (error) {
    await removeImages(bucket, [row.image_key]);
    if (isUniqueViolation(error)) return { status: "shortcode_taken" };
    throw error;
  }
  if (changes === 0) {
    await removeImages(bucket, [row.image_key]);
    return { status: "limit_reached", used: input.limit, limit: input.limit };
  }
  return { status: "created", row };
}

export type UpdateCustomEmojiResult =
  | { status: "updated"; row: CustomEmojiRow }
  | { status: "not_found" }
  | { status: "shortcode_taken" };

/** Renames and/or replaces the aliases. The image never changes under one id. */
export async function updateCustomEmoji(
  db: D1DatabaseLike,
  appId: string,
  emojiId: string,
  changes: { shortcode?: string; aliases?: string[] },
): Promise<UpdateCustomEmojiResult> {
  const current = await findCustomEmoji(db, appId, emojiId);
  if (!current) return { status: "not_found" };
  const row: CustomEmojiRow = {
    ...current,
    shortcode: changes.shortcode ?? current.shortcode,
    aliases: changes.aliases ? JSON.stringify(changes.aliases) : current.aliases,
  };
  try {
    await db
      .prepare("UPDATE custom_emoji SET shortcode = ?, aliases = ? WHERE id = ? AND app_id = ?")
      .bind(row.shortcode, row.aliases, emojiId, appId)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "shortcode_taken" };
    throw error;
  }
  return { status: "updated", row };
}

/**
 * Removes images; R2 deletes at most 1000 keys per call. Rows go first, so a failure here leaves
 * orphan objects, never rows that point at missing images. It is logged, not thrown.
 */
export async function removeImages(bucket: EmojiBucket | undefined, keys: readonly string[]): Promise<void> {
  if (!bucket) return;
  try {
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
  } catch (error) {
    console.warn(JSON.stringify({ event: "emoji_image_delete_failed", error: (error as Error).name }));
  }
}

/** Deletes the row, then its image. Returns the deleted row, or undefined if there was none. */
export async function deleteCustomEmoji(
  db: D1DatabaseLike,
  bucket: EmojiBucket | undefined,
  appId: string,
  emojiId: string,
): Promise<CustomEmojiRow | undefined> {
  const row = await db
    .prepare("DELETE FROM custom_emoji WHERE id = ? AND app_id = ? RETURNING *")
    .bind(emojiId, appId)
    .first<CustomEmojiRow>();
  if (row) await removeImages(bucket, [row.image_key]);
  return row ?? undefined;
}

/** For the tenants API: `DELETE /v1/tenants/:externalId/emoji/:shortcode`. */
export async function deleteCustomEmojiByShortcode(
  db: D1DatabaseLike,
  bucket: EmojiBucket | undefined,
  appId: string,
  tenantId: string | null,
  shortcode: string,
): Promise<CustomEmojiRow | undefined> {
  const row = await db
    .prepare("DELETE FROM custom_emoji WHERE app_id = ? AND tenant_id = ? AND shortcode = ? RETURNING *")
    .bind(appId, tenantColumn(tenantId), shortcode)
    .first<CustomEmojiRow>();
  if (row) await removeImages(bucket, [row.image_key]);
  return row ?? undefined;
}
