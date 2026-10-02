/**
 * Tenants (Scale): the app owner's own customers, each with its own custom emoji. Shared by the
 * public tenants API (`/v1/tenants`, keyed by external id) and the dashboard (keyed by tenant id).
 */
import type { D1DatabaseLike, Parsed } from "./d1-like.js";
import { randomId } from "./keys.js";
import { type EmojiBucket, removeImages } from "./tenant-emoji-storage.js";
import type { TenantRow } from "./types.js";

/** URL-safe, because it appears in `/v1/tenants/:externalId`: ids, slugs, UUIDs, emails. */
const EXTERNAL_ID = /^[A-Za-z0-9._~:@+-]{1,128}$/;
const CONTROL_CHARS = /\p{Cc}/u;
export const MAX_TENANT_NAME = 100;
export const DEFAULT_TENANT_PAGE = 100;
export const MAX_TENANT_PAGE = 500;

/** The JSON shape of a tenant in both APIs. */
export interface Tenant {
  id: string;
  externalId: string;
  name: string | null;
  createdAt: number;
  emojiCount?: number;
}

export interface TenantPage {
  tenants: Tenant[];
  /** Pass as `cursor` to read the next page; null on the last page. */
  nextCursor: string | null;
}

export function toTenant(row: TenantRow, emojiCount?: number): Tenant {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    createdAt: row.created_at,
    ...(emojiCount === undefined ? {} : { emojiCount }),
  };
}

export function parseExternalId(value: unknown): Parsed<string> {
  if (typeof value === "string" && EXTERNAL_ID.test(value)) return { ok: true, value };
  return {
    ok: false,
    field: "externalId",
    message: "externalId must be 1–128 characters of letters, digits and . _ ~ : @ + -",
  };
}

export function parseTenantName(value: unknown): Parsed<string | null> {
  const invalid = (message: string) => ({ ok: false as const, field: "name", message });
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return invalid("name must be text.");
  const name = value.trim();
  if (name.length > MAX_TENANT_NAME) return invalid(`name can have at most ${MAX_TENANT_NAME} characters.`);
  if (CONTROL_CHARS.test(name)) return invalid("name cannot contain control characters.");
  return { ok: true, value: name === "" ? null : name };
}

/** `limit` 1–500 (default 100); a bad value falls back to the default. */
export function parsePageLimit(raw: string | null): number {
  const value = Number(raw ?? DEFAULT_TENANT_PAGE);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_TENANT_PAGE) : DEFAULT_TENANT_PAGE;
}

/**
 * Creates the tenant, or returns the one that already has this external id (`created: false`,
 * name unchanged). One statement, so two parallel calls cannot create two rows.
 */
export async function createTenant(
  db: D1DatabaseLike,
  input: { appId: string; externalId: string; name: string | null; now: number },
): Promise<{ tenant: TenantRow; created: boolean }> {
  const id = randomId();
  const { meta } = await db
    .prepare(
      `INSERT INTO tenants (id, app_id, external_id, name, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (app_id, external_id) DO NOTHING`,
    )
    .bind(id, input.appId, input.externalId, input.name, input.now)
    .run();
  const tenant = await findTenantByExternalId(db, input.appId, input.externalId);
  if (!tenant) throw new Error("tenant missing after insert");
  return { tenant, created: meta.changes > 0 };
}

export async function findTenantByExternalId(
  db: D1DatabaseLike,
  appId: string,
  externalId: string,
): Promise<TenantRow | undefined> {
  const row = await db
    .prepare("SELECT * FROM tenants WHERE app_id = ? AND external_id = ?")
    .bind(appId, externalId)
    .first<TenantRow>();
  return row ?? undefined;
}

export async function findTenantById(
  db: D1DatabaseLike,
  appId: string,
  tenantId: string,
): Promise<TenantRow | undefined> {
  const row = await db
    .prepare("SELECT * FROM tenants WHERE app_id = ? AND id = ?")
    .bind(appId, tenantId)
    .first<TenantRow>();
  return row ?? undefined;
}

export async function countTenantEmoji(db: D1DatabaseLike, tenant: TenantRow): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM custom_emoji WHERE app_id = ? AND tenant_id = ?")
    .bind(tenant.app_id, tenant.id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Ordered by external id; the cursor is the last external id of the previous page. */
export async function listTenants(
  db: D1DatabaseLike,
  appId: string,
  options: { limit: number; cursor: string | null },
): Promise<TenantPage> {
  const { results } = await db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM custom_emoji ce WHERE ce.app_id = t.app_id AND ce.tenant_id = t.id)
         AS emoji_count
       FROM tenants t WHERE t.app_id = ? AND t.external_id > ? ORDER BY t.external_id LIMIT ?`,
    )
    .bind(appId, options.cursor ?? "", options.limit + 1)
    .all<TenantRow & { emoji_count: number }>();
  const page = results.slice(0, options.limit);
  return {
    tenants: page.map((row) => toTenant(row, row.emoji_count)),
    nextCursor: results.length > options.limit ? (page.at(-1)?.external_id ?? null) : null,
  };
}

/**
 * Deletes the tenant and its custom emoji (rows in one transaction, then the images). Returns
 * how many emoji were removed.
 */
export async function deleteTenant(
  db: D1DatabaseLike,
  bucket: EmojiBucket | undefined,
  tenant: TenantRow,
): Promise<{ emojiDeleted: number }> {
  const { results } = await db
    .prepare("SELECT image_key FROM custom_emoji WHERE app_id = ? AND tenant_id = ?")
    .bind(tenant.app_id, tenant.id)
    .all<{ image_key: string }>();
  await db.batch([
    db.prepare("DELETE FROM custom_emoji WHERE app_id = ? AND tenant_id = ?").bind(tenant.app_id, tenant.id),
    db.prepare("DELETE FROM tenants WHERE id = ?").bind(tenant.id),
  ]);
  await removeImages(
    bucket,
    results.map((row) => row.image_key),
  );
  return { emojiDeleted: results.length };
}
