/**
 * Deletes an account and everything it owns (docs/API.md, `DELETE /api/me`): its apps with their
 * keys, usage, search analytics, tenants, custom emoji (rows and R2 images) and webhooks; its own
 * team (members and invites) and its memberships in other teams; legacy session rows; and the
 * waitlist entry of its email. A Clerk account leaves its Clerk user id in `deleted_clerk_users`
 * for 10 minutes (migration 0003), so a session token from before the deletion cannot recreate it.
 */
import type { AccountRow, EmojiBucket } from "@emojisense/platform";
import type { D1Database, D1PreparedStatement } from "./d1";
import { HttpError } from "./http";

/** R2 deletes at most this many keys per call. */
const R2_DELETE_MAX_KEYS = 1000;

/** Longer than a Clerk session token lives (60 s), with room for clock skew. */
export const DELETED_CLERK_USER_TTL_MS = 10 * 60 * 1000;

const OWNED_APPS = "SELECT id FROM apps WHERE account_id = ?";

/** Tables keyed by `app_id`. Their rows go before the apps. */
const APP_TABLES = [
  "custom_emoji",
  "tenants",
  "webhooks",
  "query_daily",
  "usage_monthly",
  "api_keys",
] as const;

export interface AccountDeletion {
  apps: number;
  customEmoji: number;
}

/**
 * Children before parents, so the batch does not depend on ON DELETE CASCADE. D1 runs a batch as
 * one transaction: either every row goes or none does.
 */
function deleteStatements(db: D1Database, account: AccountRow, now: number): D1PreparedStatement[] {
  const id = account.id;
  return [
    db
      .prepare(
        `DELETE FROM webhook_deliveries WHERE webhook_id IN
           (SELECT id FROM webhooks WHERE app_id IN (${OWNED_APPS}))`,
      )
      .bind(id),
    ...APP_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE app_id IN (${OWNED_APPS})`).bind(id)),
    db.prepare("DELETE FROM apps WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM team_members WHERE owner_id = ? OR member_id = ?").bind(id, id),
    db.prepare("DELETE FROM team_invites WHERE owner_id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(id),
    ...(account.email
      ? [db.prepare("DELETE FROM waitlist WHERE email = ? COLLATE NOCASE").bind(account.email)]
      : []),
    db.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
    db.prepare("DELETE FROM deleted_clerk_users WHERE deleted_at <= ?").bind(now - DELETED_CLERK_USER_TTL_MS),
    ...(account.clerk_user_id
      ? [
          db
            .prepare("INSERT OR REPLACE INTO deleted_clerk_users (clerk_user_id, deleted_at) VALUES (?, ?)")
            .bind(account.clerk_user_id, now),
        ]
      : []),
  ];
}

const storageUnavailable = () =>
  new HttpError(
    503,
    "storage_unavailable",
    "We could not delete your custom emoji images, so your account was not deleted. Try again in a few minutes.",
  );

/** Throws (503) before any row is deleted, so a retry finds every image key again. */
async function deleteImages(bucket: EmojiBucket | undefined, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  if (!bucket) throw storageUnavailable();
  try {
    for (let i = 0; i < keys.length; i += R2_DELETE_MAX_KEYS) {
      await bucket.delete(keys.slice(i, i + R2_DELETE_MAX_KEYS));
    }
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", event: "account_images_delete_failed", error: (error as Error).name }),
    );
    throw storageUnavailable();
  }
}

/**
 * The images go first. When R2 fails, nothing in D1 is deleted and the person can try again.
 * When the D1 batch fails after that, the rows point at deleted images until the retry removes
 * them; an image is never left without its row.
 */
export async function deleteAccount(
  db: D1Database,
  bucket: EmojiBucket | undefined,
  account: AccountRow,
  now: number,
): Promise<AccountDeletion> {
  const [{ results: images }, apps] = await Promise.all([
    db
      .prepare(`SELECT image_key FROM custom_emoji WHERE app_id IN (${OWNED_APPS})`)
      .bind(account.id)
      .all<{ image_key: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM apps WHERE account_id = ?").bind(account.id).first<{ n: number }>(),
  ]);
  await deleteImages(
    bucket,
    images.map((row) => row.image_key),
  );
  await db.batch(deleteStatements(db, account, now));
  return { apps: apps?.n ?? 0, customEmoji: images.length };
}
