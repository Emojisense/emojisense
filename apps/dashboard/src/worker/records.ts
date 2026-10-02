/**
 * Row → JSON mappers and the ownership lookups. Every app or key query filters by the signed-in
 * account, and a resource of another account answers 404, the same as one that does not exist.
 */
import type { AccountRow, ApiKeyRow, AppRow } from "@emojisense/platform";
import type { AccountSummary, AppSummary, KeySummary } from "../shared/contract";
import type { D1Database } from "./d1";
import { HttpError } from "./http";
import { isValidId } from "./validate";

export type AppWithKeyCount = AppRow & { active_keys: number };
export type KeyWithEnvironment = ApiKeyRow & { environment: AppRow["environment"] };

export function toAccountSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    githubLinked: row.github_id !== null,
    createdAt: row.created_at,
  };
}

export function toAppSummary(row: AppWithKeyCount): AppSummary {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    plan: row.plan,
    createdAt: row.created_at,
    activeKeyCount: row.active_keys,
  };
}

function parseOrigins(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function toKeySummary(row: ApiKeyRow): KeySummary {
  return {
    id: row.id,
    appId: row.app_id,
    kind: row.kind,
    prefix: row.prefix,
    allowedOrigins: parseOrigins(row.allowed_origins),
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export const APP_COLUMNS = `a.id, a.account_id, a.name, a.environment, a.plan, a.created_at,
  (SELECT COUNT(*) FROM api_keys k WHERE k.app_id = a.id AND k.revoked_at IS NULL) AS active_keys`;

const appNotFound = () => new HttpError(404, "not_found", "No app with this id in your account.");
const keyNotFound = () => new HttpError(404, "not_found", "No key with this id in your account.");

export async function requireOwnedApp(
  db: D1Database,
  appId: string | undefined,
  accountId: string,
): Promise<AppWithKeyCount> {
  if (!isValidId(appId)) throw appNotFound();
  const app = await db
    .prepare(`SELECT ${APP_COLUMNS} FROM apps a WHERE a.id = ? AND a.account_id = ?`)
    .bind(appId, accountId)
    .first<AppWithKeyCount>();
  if (!app) throw appNotFound();
  return app;
}

export async function requireOwnedKey(
  db: D1Database,
  keyId: string | undefined,
  accountId: string,
): Promise<KeyWithEnvironment> {
  if (!isValidId(keyId)) throw keyNotFound();
  const key = await db
    .prepare(
      `SELECT k.*, a.environment FROM api_keys k JOIN apps a ON a.id = k.app_id
       WHERE k.id = ? AND a.account_id = ?`,
    )
    .bind(keyId, accountId)
    .first<KeyWithEnvironment>();
  if (!key) throw keyNotFound();
  return key;
}
