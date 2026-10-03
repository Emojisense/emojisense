/** Row → JSON mappers and the app query that access.ts and the app list share. */
import { type AccountRow, type ApiKeyRow, type AppRow, getPlan } from "@emojisense/platform";
import type { AccountSummary, AppSummary, KeySummary, Role } from "../shared/contract";
import type { D1Database, D1PreparedStatement, D1Value } from "./d1";

/** An app joined with its owner and the caller's membership (queryApps). */
export interface AppRecord extends AppRow {
  owner_plan: string;
  owner_name: string | null;
  owner_email: string | null;
  active_keys: number;
  active_prod: number;
  active_staging: number;
  active_dev: number;
  /** "owner" when the caller owns the app, the `team_members` role, or null for no membership. */
  role: Role | null;
}

const APP_SELECT = `
  SELECT a.id, a.account_id, a.name, a.environment, a.emoji_set, a.created_at,
    o.plan AS owner_plan, o.name AS owner_name, o.email AS owner_email,
    (SELECT COUNT(*) FROM api_keys k WHERE k.app_id = a.id AND k.revoked_at IS NULL) AS active_keys,
    (SELECT COUNT(*) FROM api_keys k
      WHERE k.app_id = a.id AND k.revoked_at IS NULL AND k.environment = 'prod') AS active_prod,
    (SELECT COUNT(*) FROM api_keys k
      WHERE k.app_id = a.id AND k.revoked_at IS NULL AND k.environment = 'staging') AS active_staging,
    (SELECT COUNT(*) FROM api_keys k
      WHERE k.app_id = a.id AND k.revoked_at IS NULL AND k.environment = 'dev') AS active_dev,
    CASE WHEN a.account_id = ? THEN 'owner' ELSE tm.role END AS role
  FROM apps a
  JOIN accounts o ON o.id = a.account_id
  LEFT JOIN team_members tm ON tm.owner_id = a.account_id AND tm.member_id = ?`;

/**
 * Apps with their owner and the caller's role (`role`). `tail` adds WHERE / ORDER BY with its
 * own `?` parameters, bound from `params`.
 */
export function queryApps(
  db: D1Database,
  accountId: string,
  tail: string,
  ...params: D1Value[]
): D1PreparedStatement {
  return db.prepare(`${APP_SELECT} ${tail}`).bind(accountId, accountId, ...params);
}

/**
 * The caller's role, or undefined without access. A membership counts only while the owner's
 * plan includes team members; after a downgrade the rows stay and work again after an upgrade.
 */
export function effectiveRole(row: Pick<AppRecord, "role" | "owner_plan">): Role | undefined {
  if (row.role === "owner") return "owner";
  if (row.role === null) return undefined;
  return getPlan(row.owner_plan).teamMembers ? row.role : undefined;
}

export function toAccountSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    signIn: row.clerk_user_id !== null ? "clerk" : "dev",
    createdAt: row.created_at,
  };
}

/** Shown where a person is named: the name, else the email. */
export function displayName(row: { name: string | null; email: string | null }): string | null {
  return row.name ?? row.email;
}

export function toAppSummary(row: AppRecord, role: Role): AppSummary {
  return {
    id: row.id,
    name: row.name,
    plan: getPlan(row.owner_plan).id,
    emojiSet: row.emoji_set,
    createdAt: row.created_at,
    activeKeyCount: row.active_keys,
    activeKeysByEnvironment: { prod: row.active_prod, staging: row.active_staging, dev: row.active_dev },
    role,
    ownerId: row.account_id,
    ownerName: displayName({ name: row.owner_name, email: row.owner_email }),
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
    environment: row.environment,
    prefix: row.prefix,
    allowedOrigins: parseOrigins(row.allowed_origins),
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}
