/**
 * Team (Pro and Scale): other accounts that work on the owner's apps. Routes act on the team of
 * `?owner=<accountId>`, by default the caller's own. Invites are links with a random token that is
 * shown once; D1 stores only its SHA-256. The invite email is a label and is not checked.
 */
import { getPlan, type Plan, randomId, type TeamInviteRow, type TeamRole } from "@emojisense/platform";
import type {
  AcceptInviteResponse,
  CreatedInviteResponse,
  OkResponse,
  TeamInviteSummary,
  TeamMemberResponse,
  TeamMemberSummary,
  TeamResponse,
} from "../../shared/contract";
import { requireTeamAccess, type TeamAccess } from "../access";
import { randomToken, sha256Hex } from "../crypto";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { requirePlan } from "../plans";
import { displayName } from "../records";
import { isValidId, parseOptionalEmail, parseTeamRole } from "../validate";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const requireTeamPlan = (plan: Plan) => requirePlan(plan, (p) => p.teamMembers, "A team");

function toInviteSummary(row: TeamInviteRow): TeamInviteSummary {
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

const memberNotFound = () => new HttpError(404, "not_found", "No member with this id in the team.");

function assertNotOwner(team: TeamAccess, memberId: string): void {
  if (memberId === team.owner.id) {
    throw new HttpError(
      409,
      "owner_immutable",
      "The owner's role cannot change, and the owner cannot leave.",
    );
  }
}

export async function getTeam(ctx: AuthedContext): Promise<Response> {
  const team = await requireTeamAccess(ctx, "view");
  requireTeamPlan(team.plan);
  const db = ctx.env.DB;
  const [members, invites] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.name, a.email, tm.role, tm.created_at FROM team_members tm
         JOIN accounts a ON a.id = tm.member_id
         WHERE tm.owner_id = ? ORDER BY tm.created_at, a.id`,
      )
      .bind(team.owner.id)
      .all<{ id: string; name: string | null; email: string | null; role: TeamRole; created_at: number }>(),
    db
      .prepare(
        `SELECT * FROM team_invites WHERE owner_id = ? AND accepted_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC, id`,
      )
      .bind(team.owner.id, ctx.deps.now())
      .all<TeamInviteRow>(),
  ]);
  const { owner } = team;
  const body: TeamResponse = {
    ownerId: owner.id,
    role: team.role,
    members: [
      { id: owner.id, name: owner.name, email: owner.email, role: "owner", createdAt: owner.created_at },
      ...members.results.map(
        (row): TeamMemberSummary => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          createdAt: row.created_at,
        }),
      ),
    ],
    invites: invites.results.map(toInviteSummary),
  };
  return json(body);
}

/** `{ role, email? }` → the invite and its link. The link is shown only in this response. */
export async function createInvite(ctx: AuthedContext): Promise<Response> {
  const team = await requireTeamAccess(ctx, "manage_team");
  requireTeamPlan(team.plan);
  const body = await readJsonObject(ctx.request);
  const role = parseTeamRole(body.role);
  const email = parseOptionalEmail(body.email);

  const token = randomToken(32);
  const now = ctx.deps.now();
  const row: TeamInviteRow = {
    id: randomId(),
    owner_id: team.owner.id,
    role,
    token_hash: await sha256Hex(token),
    email,
    created_at: now,
    expires_at: now + INVITE_TTL_MS,
    accepted_at: null,
  };
  await ctx.env.DB.prepare(
    `INSERT INTO team_invites (id, owner_id, role, token_hash, email, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.owner_id, row.role, row.token_hash, row.email, row.created_at, row.expires_at)
    .run();
  const response: CreatedInviteResponse = {
    invite: toInviteSummary(row),
    url: `${ctx.url.origin}/invite/${token}`,
  };
  return json(response, 201);
}

/** Withdraws an open invite. Works on any plan, so a downgraded owner can clean up. */
export async function deleteInvite(ctx: AuthedContext): Promise<Response> {
  const team = await requireTeamAccess(ctx, "manage_team");
  const inviteId = ctx.params.id;
  const result = isValidId(inviteId)
    ? await ctx.env.DB.prepare(
        "DELETE FROM team_invites WHERE id = ? AND owner_id = ? AND accepted_at IS NULL",
      )
        .bind(inviteId, team.owner.id)
        .run()
    : undefined;
  if (!result || result.meta.changes === 0) {
    throw new HttpError(404, "not_found", "No open invite with this id in the team.");
  }
  const response: OkResponse = { ok: true };
  return json(response);
}

/** `{ role }`. Admins may change any member, other admins and themselves included. */
export async function updateMember(ctx: AuthedContext): Promise<Response> {
  const team = await requireTeamAccess(ctx, "manage_team");
  requireTeamPlan(team.plan);
  const memberId = ctx.params.id ?? "";
  assertNotOwner(team, memberId);
  const body = await readJsonObject(ctx.request);
  const role = parseTeamRole(body.role);
  if (!isValidId(memberId)) throw memberNotFound();
  const db = ctx.env.DB;
  const updated = await db
    .prepare("UPDATE team_members SET role = ? WHERE owner_id = ? AND member_id = ?")
    .bind(role, team.owner.id, memberId)
    .run();
  if (updated.meta.changes === 0) throw memberNotFound();
  const row = await db
    .prepare(
      `SELECT a.name, a.email, tm.created_at FROM team_members tm JOIN accounts a ON a.id = tm.member_id
       WHERE tm.owner_id = ? AND tm.member_id = ?`,
    )
    .bind(team.owner.id, memberId)
    .first<{ name: string | null; email: string | null; created_at: number }>();
  if (!row) throw memberNotFound();
  const response: TeamMemberResponse = {
    member: { id: memberId, name: row.name, email: row.email, role, createdAt: row.created_at },
  };
  return json(response);
}

/** Admins remove members; any member may remove themselves (leave). Works on any plan. */
export async function removeMember(ctx: AuthedContext): Promise<Response> {
  const memberId = ctx.params.id ?? "";
  const leaving = memberId === ctx.account.id;
  const team = await requireTeamAccess(ctx, leaving ? "view" : "manage_team");
  assertNotOwner(team, memberId);
  const result = isValidId(memberId)
    ? await ctx.env.DB.prepare("DELETE FROM team_members WHERE owner_id = ? AND member_id = ?")
        .bind(team.owner.id, memberId)
        .run()
    : undefined;
  if (!result || result.meta.changes === 0) throw memberNotFound();
  const response: OkResponse = { ok: true };
  return json(response);
}

interface InviteWithOwner extends TeamInviteRow {
  owner_name: string | null;
  owner_email: string | null;
  owner_plan: string;
}

/**
 * `POST /api/invites/:token/accept`: the signed-in account joins the owner's team with the
 * invite's role. An invite works once and for 7 days.
 */
export async function acceptInvite({ env, deps, account, params }: AuthedContext): Promise<Response> {
  const token = params.token ?? "";
  const invite = INVITE_TOKEN.test(token)
    ? await env.DB.prepare(
        `SELECT i.*, o.name AS owner_name, o.email AS owner_email, o.plan AS owner_plan
         FROM team_invites i JOIN accounts o ON o.id = i.owner_id WHERE i.token_hash = ?`,
      )
        .bind(await sha256Hex(token))
        .first<InviteWithOwner>()
    : null;
  const now = deps.now();
  if (!invite) throw new HttpError(404, "invite_not_found", "This invite link is not valid.");
  if (invite.accepted_at !== null) {
    throw new HttpError(410, "invite_used", "This invite was already used. Ask for a new one.");
  }
  if (invite.expires_at <= now) {
    throw new HttpError(410, "invite_expired", "This invite has expired. Ask for a new one.");
  }
  if (invite.owner_id === account.id) {
    throw new HttpError(409, "invite_own_team", "This invite is for your own team.");
  }
  requireTeamPlan(getPlan(invite.owner_plan));
  const membership = env.DB.prepare(
    "SELECT role FROM team_members WHERE owner_id = ? AND member_id = ?",
  ).bind(invite.owner_id, account.id);
  if (await membership.first()) {
    throw new HttpError(409, "already_member", "You are already a member of this team.");
  }

  // One transaction. The INSERT copies the invite only while it is still open, so of two
  // parallel accepts only the first joins; the second finds no membership below.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO team_members (owner_id, member_id, role, created_at)
       SELECT owner_id, ?, role, ? FROM team_invites WHERE id = ? AND accepted_at IS NULL AND expires_at > ?
       ON CONFLICT (owner_id, member_id) DO NOTHING`,
    ).bind(account.id, now, invite.id, now),
    env.DB.prepare("UPDATE team_invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL").bind(
      now,
      invite.id,
    ),
  ]);
  const joined = await membership.first<{ role: TeamRole }>();
  if (!joined) throw new HttpError(410, "invite_used", "This invite was already used. Ask for a new one.");

  const response: AcceptInviteResponse = {
    team: {
      ownerId: invite.owner_id,
      ownerName: displayName({ name: invite.owner_name, email: invite.owner_email }),
      role: joined.role,
    },
  };
  return json(response);
}
