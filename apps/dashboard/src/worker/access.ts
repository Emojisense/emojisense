/**
 * The single gate for app, key and team routes. An account reaches an app as its owner or as a
 * team member of the owner (Pro and Scale). An app or key without access answers 404, the same
 * as one that does not exist; access with too low a role answers 403 `forbidden_role`.
 */
import { type AccountRow, type ApiKeyRow, getPlan, type Plan, type TeamRole } from "@emojisense/platform";
import type { Role, TeamSummary } from "../shared/contract";
import type { D1Database } from "./d1";
import type { AuthedContext } from "./env";
import { HttpError } from "./http";
import { type AppRecord, displayName, effectiveRole, queryApps } from "./records";
import { isValidId } from "./validate";

/**
 * view: read apps, keys, usage, analytics, team. edit: apps, keys, custom emoji, webhooks
 * (developer). manage_team and view_billing: admin. change_plan: the owner only.
 */
export type Permission = "view" | "edit" | "manage_team" | "view_billing" | "change_plan";

const ROLE_RANK: Record<Role, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };
const MIN_ROLE: Record<Permission, Role> = {
  view: "viewer",
  edit: "developer",
  manage_team: "admin",
  view_billing: "admin",
  change_plan: "owner",
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[permission]];
}

export function assertCan(role: Role, permission: Permission): void {
  if (can(role, permission)) return;
  const min = MIN_ROLE[permission];
  throw new HttpError(
    403,
    "forbidden_role",
    min === "owner"
      ? "Only the owner can do this."
      : `This needs the ${min} role or higher. Your role is ${role}. Ask the owner or an admin.`,
  );
}

export interface AppAccess {
  role: Role;
  /** The owning account's plan, which the app gets. */
  plan: Plan;
  app: AppRecord;
}

/** The contract's `accessFor(db, accountId, appId) → { role } | undefined`, plus the app and plan. */
export async function accessFor(
  db: D1Database,
  accountId: string,
  appId: string | undefined,
): Promise<AppAccess | undefined> {
  if (!isValidId(appId)) return undefined;
  const app = await queryApps(db, accountId, "WHERE a.id = ?", appId).first<AppRecord>();
  if (!app) return undefined;
  const role = effectiveRole(app);
  return role ? { role, plan: getPlan(app.owner_plan), app } : undefined;
}

const appNotFound = () => new HttpError(404, "not_found", "No app with this id in your account or teams.");
const keyNotFound = () => new HttpError(404, "not_found", "No key with this id in your account or teams.");

export async function requireAppAccess(
  db: D1Database,
  accountId: string,
  appId: string | undefined,
  permission: Permission,
): Promise<AppAccess> {
  const access = await accessFor(db, accountId, appId);
  if (!access) throw appNotFound();
  assertCan(access.role, permission);
  return access;
}

/** A key and the caller's access to its app. */
export async function requireKeyAccess(
  db: D1Database,
  accountId: string,
  keyId: string | undefined,
  permission: Permission,
): Promise<{ key: ApiKeyRow; access: AppAccess }> {
  if (!isValidId(keyId)) throw keyNotFound();
  const key = await db.prepare("SELECT * FROM api_keys WHERE id = ?").bind(keyId).first<ApiKeyRow>();
  const access = key ? await accessFor(db, accountId, key.app_id) : undefined;
  if (!key || !access) throw keyNotFound();
  assertCan(access.role, permission);
  return { key, access };
}

export interface TeamAccess {
  role: Role;
  owner: AccountRow;
  plan: Plan;
}

/**
 * The caller's role on the team of `ownerId`: owner of their own team, or a member's role. A
 * member's access pauses while the owner's plan has no team, unless `includePaused` is set.
 */
export async function teamAccessFor(
  db: D1Database,
  account: AccountRow,
  ownerId: string,
  includePaused = false,
): Promise<TeamAccess | undefined> {
  if (ownerId === account.id) return { role: "owner", owner: account, plan: getPlan(account.plan) };
  if (!isValidId(ownerId)) return undefined;
  const row = await db
    .prepare(
      `SELECT o.*, tm.role AS member_role FROM team_members tm JOIN accounts o ON o.id = tm.owner_id
       WHERE tm.owner_id = ? AND tm.member_id = ?`,
    )
    .bind(ownerId, account.id)
    .first<AccountRow & { member_role: TeamRole }>();
  if (!row) return undefined;
  const { member_role: role, ...owner } = row;
  const plan = getPlan(owner.plan);
  return plan.teamMembers || includePaused ? { role, owner, plan } : undefined;
}

/** Teams of other owners the account belongs to, while the owner's plan includes team members. */
export async function listMemberships(db: D1Database, accountId: string): Promise<TeamSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT tm.owner_id, tm.role, o.name, o.email, o.plan FROM team_members tm
       JOIN accounts o ON o.id = tm.owner_id
       WHERE tm.member_id = ? ORDER BY tm.created_at, tm.owner_id`,
    )
    .bind(accountId)
    .all<{ owner_id: string; role: TeamRole; name: string | null; email: string | null; plan: string }>();
  return results
    .filter((row) => getPlan(row.plan).teamMembers)
    .map((row) => ({ ownerId: row.owner_id, ownerName: displayName(row), role: row.role }));
}

/** Team routes act on `?owner=<accountId>`, by default the caller's own team. */
export async function requireTeamAccess(
  { url, env, account }: AuthedContext,
  permission: Permission,
  includePaused = false,
): Promise<TeamAccess> {
  const ownerId = url.searchParams.get("owner") || account.id;
  const access = await teamAccessFor(env.DB, account, ownerId, includePaused);
  if (!access) throw new HttpError(404, "not_found", "You are not a member of this team.");
  assertCan(access.role, permission);
  return access;
}
