/**
 * Custom emoji storage: rows in D1 (`custom_emoji`), images in R2 (binding `EMOJI`). Used by the
 * dashboard (app-wide and tenant emoji) and the API Worker (packs, images, tenants API).
 *
 * `tenantId` arguments are `tenants.id` values; `null` means app-wide (stored as "").
 * The D1 and R2 types are structural, so the real bindings and the test fakes both fit.
 */
import { customEmojiImageKey } from "./custom-emoji.js";
import type { EmojiImage } from "./emoji-image.js";
import type { CustomEmojiRow, CustomEmojiSource } from "./types.js";

export type SqlValue = string | number | null;

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/** Enough of D1 to read. The API Worker's search path only reads. */
export interface SqlReader {
  prepare(sql: string): SqlStatement;
}

export interface SqlWriteStatement extends SqlStatement {
  bind(...values: SqlValue[]): SqlWriteStatement;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase extends SqlReader {
  prepare(sql: string): SqlWriteStatement;
}

export interface EmojiObject {
  body: ReadableStream;
  size: number;
  httpEtag?: string;
}

/** The R2 calls custom emoji need. */
export interface EmojiBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<EmojiObject | null>;
  delete(keys: string | string[]): Promise<void>;
}

/** Images never change under one id (a new image is a new emoji), so caches may keep them. */
export const CUSTOM_EMOJI_CACHE_CONTROL = "public, max-age=31536000, immutable";

const tenantColumn = (tenantId: string | null) => tenantId ?? "";

export async function countCustomEmoji(db: SqlReader, appId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM custom_emoji WHERE app_id = ?")
    .bind(appId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Newest first. `tenantId`: undefined = every emoji of the app, null = app-wide only, a string =
 * that tenant's only.
 */
export async function listCustomEmoji(
  db: SqlReader,
  appId: string,
  options: { tenantId?: string | null } = {},
): Promise<CustomEmojiRow[]> {
  const statement =
    options.tenantId === undefined
      ? db.prepare("SELECT * FROM custom_emoji WHERE app_id = ? ORDER BY created_at DESC, id").bind(appId)
      : db
          .prepare(
            "SELECT * FROM custom_emoji WHERE app_id = ? AND tenant_id = ? ORDER BY created_at DESC, id",
          )
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

/** `tenants.id` for the owner's own customer id (`external_id`), if that tenant exists. */
export async function findTenantId(
  db: SqlReader,
  appId: string,
  externalId: string,
): Promise<string | undefined> {
  const row = await db
    .prepare("SELECT id FROM tenants WHERE app_id = ? AND external_id = ?")
    .bind(appId, externalId)
    .first<{ id: string }>();
  return row?.id;
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
  tenantId: string | null;
  shortcode: string;
  aliases: string[];
  image: EmojiImage;
  source: CustomEmojiSource;
  /** The plan's custom_emoji limit for the whole app (all tenants). Infinity = unlimited. */
  limit: number;
  now: number;
  /** Random URL-safe id. */
  id: string;
}

export type CreateCustomEmojiResult =
  | { status: "created"; row: CustomEmojiRow }
  | { status: "shortcode_taken" }
  | { status: "limit_reached" };

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed/i.test(error.message);

/**
 * Stores the image in R2, then inserts the row. The limit check is part of the INSERT, so two
 * parallel uploads cannot pass it together. On any refusal the image is removed again.
 */
export async function createCustomEmoji(
  db: SqlDatabase,
  bucket: EmojiBucket,
  input: NewCustomEmoji,
): Promise<CreateCustomEmojiResult> {
  if (await findCustomEmojiByShortcode(db, input.appId, input.tenantId, input.shortcode)) {
    return { status: "shortcode_taken" };
  }
  const limited = Number.isFinite(input.limit);
  if (limited && (await countCustomEmoji(db, input.appId)) >= input.limit) return { status: "limit_reached" };

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
             WHERE (SELECT COUNT(*) FROM custom_emoji WHERE app_id = ?) < ?`,
          )
          .bind(...values, row.app_id, input.limit)
      : db
          .prepare(`INSERT INTO custom_emoji (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(...values);
    changes = (await insert.run()).meta.changes;
  } catch (error) {
    await bucket.delete(row.image_key);
    if (isUniqueViolation(error)) return { status: "shortcode_taken" };
    throw error;
  }
  if (changes === 0) {
    await bucket.delete(row.image_key);
    return { status: "limit_reached" };
  }
  return { status: "created", row };
}

export type UpdateCustomEmojiResult =
  | { status: "updated"; row: CustomEmojiRow }
  | { status: "not_found" }
  | { status: "shortcode_taken" };

/** Renames and/or replaces the aliases. The image never changes under one id. */
export async function updateCustomEmoji(
  db: SqlDatabase,
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

async function deleteImages(bucket: EmojiBucket, rows: readonly CustomEmojiRow[]): Promise<void> {
  // R2 deletes up to 1000 keys per call.
  for (let i = 0; i < rows.length; i += 1000) {
    await bucket.delete(rows.slice(i, i + 1000).map((row) => row.image_key));
  }
}

/** Deletes the row, then its image. Returns the deleted row, or undefined if there was none. */
export async function deleteCustomEmoji(
  db: SqlDatabase,
  bucket: EmojiBucket,
  appId: string,
  emojiId: string,
): Promise<CustomEmojiRow | undefined> {
  const row = await db
    .prepare("DELETE FROM custom_emoji WHERE id = ? AND app_id = ? RETURNING *")
    .bind(emojiId, appId)
    .first<CustomEmojiRow>();
  if (row) await deleteImages(bucket, [row]);
  return row ?? undefined;
}

/** For the tenants API: `DELETE /v1/tenants/:externalId/emoji/:shortcode`. */
export async function deleteCustomEmojiByShortcode(
  db: SqlDatabase,
  bucket: EmojiBucket,
  appId: string,
  tenantId: string | null,
  shortcode: string,
): Promise<CustomEmojiRow | undefined> {
  const row = await db
    .prepare("DELETE FROM custom_emoji WHERE app_id = ? AND tenant_id = ? AND shortcode = ? RETURNING *")
    .bind(appId, tenantColumn(tenantId), shortcode)
    .first<CustomEmojiRow>();
  if (row) await deleteImages(bucket, [row]);
  return row ?? undefined;
}

/**
 * Deletes every emoji of one tenant (rows and images), e.g. when the tenant is deleted:
 * `custom_emoji.tenant_id` has no foreign key, so nothing cascades. Returns the number deleted.
 */
export async function deleteTenantCustomEmoji(
  db: SqlDatabase,
  bucket: EmojiBucket,
  appId: string,
  tenantId: string,
): Promise<number> {
  const { results } = await db
    .prepare("DELETE FROM custom_emoji WHERE app_id = ? AND tenant_id = ? RETURNING *")
    .bind(appId, tenantId)
    .all<CustomEmojiRow>();
  await deleteImages(bucket, results);
  return results.length;
}
