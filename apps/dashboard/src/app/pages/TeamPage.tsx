import { type FormEvent, useId, useState } from "react";
import {
  api,
  type CreatedInviteResponse,
  errorMessage,
  TEAM_ROLES,
  type TeamInviteSummary,
  type TeamMemberSummary,
  type TeamResponse,
  type TeamRole,
} from "../api";
import { formatDate, formatRelative } from "../format";
import { initials } from "../lib/identity";
import { sampleTeam } from "../lib/previewSamples";
import { useResource } from "../lib/useResource";
import { useSession } from "../session";
import { RoleBadge, roleLabel } from "../ui/Badges";
import { CopyField } from "../ui/Copy";
import { Dialog } from "../ui/Dialog";
import { ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { LockedPreview } from "../ui/LockedPreview";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { useToast } from "../ui/Toast";

const ROLE_COPY: Record<TeamRole, string> = {
  admin: "Everything, except changing the plan.",
  developer: "Apps, keys, custom emoji and analytics. No team management.",
  viewer: "Read only: usage, analytics and settings.",
};

const OWN_TEAM = "";

export function TeamPage() {
  const { me, refresh } = useSession();
  const toast = useToast();
  // "" is the caller's own team; any other value is the owner id of a team they belong to.
  const [owner, setOwner] = useState(OWN_TEAM);
  const [team, { reload, mutate }] = useResource<TeamResponse>(`team:${owner}`, () =>
    api.team(owner || undefined),
  );
  const [inviting, setInviting] = useState(false);
  const canManage = team.status === "ready" && (team.data.role === "owner" || team.data.role === "admin");
  const ownerArg = owner || undefined;
  const teamName = owner ? (me.teams.find((item) => item.ownerId === owner)?.ownerName ?? "Their") : null;

  return (
    <>
      <PageHeader
        title="Team"
        lede="People who work on the apps with you. Their role decides what they can change."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
              <Icon name="plus" />
              Invite member
            </button>
          )
        }
      />
      <div className="stack-lg">
        {me.teams.length > 0 && (
          <Segmented<string>
            label="Team"
            value={owner}
            onChange={setOwner}
            options={[
              { value: OWN_TEAM, label: "Your team" },
              ...me.teams.map((item) => ({ value: item.ownerId, label: `${item.ownerName ?? "A"}’s team` })),
            ]}
          />
        )}
        {team.status === "plan" && (
          <LockedPreview feature="team" plan={team.plan}>
            <Members
              team={sampleTeam()}
              owner={undefined}
              canManage
              onChange={() => undefined}
              onRemoved={() => undefined}
            />
            <RolesCard />
          </LockedPreview>
        )}
        {team.status === "loading" && <LoadingState label="Loading team…" />}
        {team.status === "error" && <ErrorState message={team.message} onRetry={reload} />}
        {team.status === "ready" && (
          <>
            {!canManage && (
              <p className="notice">
                <span className="emoji" aria-hidden="true">
                  👀
                </span>
                <span>
                  You are a {roleLabel(team.data.role).toLowerCase()} on {teamName ?? "this"}’s team. Admins
                  and the owner manage members and invites.
                </span>
              </p>
            )}
            <Members
              team={team.data}
              owner={ownerArg}
              canManage={canManage}
              onChange={(member) =>
                mutate((data) => ({
                  ...data,
                  members: data.members.map((item) => (item.id === member.id ? member : item)),
                }))
              }
              onRemoved={(member) => {
                if (member.id === me.account.id) {
                  toast("You left the team");
                  setOwner(OWN_TEAM);
                  void refresh();
                  return;
                }
                mutate((data) => ({
                  ...data,
                  members: data.members.filter((item) => item.id !== member.id),
                }));
                toast(`Removed ${member.name ?? member.email ?? "the member"}`);
              }}
            />
            <Invites
              invites={team.data.invites}
              owner={ownerArg}
              canManage={canManage}
              onRevoked={(invite) => {
                mutate((data) => ({
                  ...data,
                  invites: data.invites.filter((item) => item.id !== invite.id),
                }));
                toast("Invite link withdrawn");
              }}
            />
            <RolesCard />
          </>
        )}
      </div>
      <InviteDialog
        open={inviting}
        owner={ownerArg}
        onClose={() => setInviting(false)}
        onCreated={(created) => mutate((data) => ({ ...data, invites: [created.invite, ...data.invites] }))}
      />
    </>
  );
}

interface MembersProps {
  team: TeamResponse;
  owner: string | undefined;
  canManage: boolean;
  onChange: (member: TeamMemberSummary) => void;
  onRemoved: (member: TeamMemberSummary) => void;
}

function Members({ team, owner, canManage, onChange, onRemoved }: MembersProps) {
  const { me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  async function changeRole(member: TeamMemberSummary, role: TeamRole) {
    setError(null);
    try {
      onChange(await api.updateMember(member.id, role, owner));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function remove(member: TeamMemberSummary) {
    setError(null);
    try {
      await api.removeMember(member.id, owner);
      onRemoved(member);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <h2 id={headingId} className="card-title">
          Members <span className="muted num">{team.members.length}</span>
        </h2>
      </div>
      {error && (
        <p className="notice notice-error card-notice" role="alert">
          {error}
        </p>
      )}
      <ul className="people">
        {team.members.map((member) => {
          const name = member.name ?? member.email ?? "Unnamed";
          const isMe = member.id === me.account.id;
          return (
            <li key={member.id} className="person">
              <span className="avatar avatar-person avatar-md" aria-hidden="true">
                {initials(member.name, member.email)}
              </span>
              <div className="person-text">
                <span className="person-name">
                  {name}
                  {isMe && <span className="muted"> (you)</span>}
                </span>
                <span className="cell-sub">
                  {member.email && member.name ? `${member.email} · ` : ""}
                  {member.role === "owner" ? "Owner since" : "Joined"} {formatDate(member.createdAt)}
                </span>
              </div>
              {member.role !== "owner" && canManage && !isMe ? (
                <div className="person-actions">
                  <label className="visually-hidden" htmlFor={`role-${member.id}`}>
                    Role of {name}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    className="input input-compact"
                    value={member.role}
                    onChange={(event) => changeRole(member, event.target.value as TeamRole)}
                  >
                    {TEAM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-icon"
                    aria-label={`Remove ${name}`}
                    title="Remove from the team"
                    onClick={() => remove(member)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ) : isMe && member.role !== "owner" ? (
                <div className="person-actions">
                  <RoleBadge value={member.role} />
                  <button type="button" className="btn btn-sm" onClick={() => remove(member)}>
                    Leave team
                  </button>
                </div>
              ) : (
                <RoleBadge value={member.role} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface InvitesProps {
  invites: TeamInviteSummary[];
  owner: string | undefined;
  canManage: boolean;
  onRevoked: (invite: TeamInviteSummary) => void;
}

function Invites({ invites, owner, canManage, onRevoked }: InvitesProps) {
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  if (invites.length === 0) return null;

  async function revoke(invite: TeamInviteSummary) {
    setError(null);
    try {
      await api.revokeInvite(invite.id, owner);
      onRevoked(invite);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <h2 id={headingId} className="card-title">
          Open invites <span className="muted num">{invites.length}</span>
        </h2>
      </div>
      {error && (
        <p className="notice notice-error card-notice" role="alert">
          {error}
        </p>
      )}
      <ul className="people">
        {invites.map((invite) => (
          <li key={invite.id} className="person">
            <span className="avatar avatar-md" aria-hidden="true">
              <Icon name="link" />
            </span>
            <div className="person-text">
              <span className="person-name">{invite.email ?? "Anyone with the link"}</span>
              <span className="cell-sub">
                {roleLabel(invite.role)} · expires {formatRelative(invite.expiresAt)}
              </span>
            </div>
            {canManage && (
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Withdraw the invite for ${invite.email ?? "anyone with the link"}`}
                onClick={() => revoke(invite)}
              >
                Withdraw
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RolesCard() {
  return (
    <section className="card" aria-label="Roles">
      <dl className="roles">
        {TEAM_ROLES.map((role) => (
          <div key={role}>
            <dt>{roleLabel(role)}</dt>
            <dd className="hint">{ROLE_COPY[role]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface InviteDialogProps {
  open: boolean;
  owner: string | undefined;
  onClose: () => void;
  onCreated: (created: CreatedInviteResponse) => void;
}

function InviteDialog({ open, owner, onClose, onCreated }: InviteDialogProps) {
  const [role, setRole] = useState<TeamRole>("developer");
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<CreatedInviteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();

  function close() {
    setCreated(null);
    setEmail("");
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.createInvite(
        { role, ...(email.trim() ? { email: email.trim() } : {}) },
        owner,
      );
      setCreated(result);
      onCreated(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={created ? "Share the invite link" : "Invite a member"}
      description={
        created ? undefined : "Create a link and send it however you like. It works once, for 7 days."
      }
      onClose={close}
      dismissible={created === null}
    >
      {created ? (
        <>
          <p className="notice notice-warning">
            <span className="emoji" aria-hidden="true">
              👀
            </span>
            <span>
              <strong>Shown once.</strong> Copy the link now.{" "}
              {created.invite.email
                ? `It works once, for ${created.invite.email} only, who joins as`
                : "The first person to open it joins as"}{" "}
              {roleLabel(created.invite.role).toLowerCase()}.
            </span>
          </p>
          <CopyField value={created.url} label="Invite link" visibleLabel autoFocus />
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <fieldset className="choices">
            <legend>Role</legend>
            {TEAM_ROLES.map((option) => (
              <label key={option} className="check">
                <input
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                />
                <span className="check-text">
                  <span className="check-title">{roleLabel(option)}</span>
                  <span className="hint">{ROLE_COPY[option]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={emailId} className="label">
              Email <span className="label-optional">optional</span>
            </label>
            <input
              id={emailId}
              className="input"
              type="email"
              autoComplete="off"
              placeholder="sam@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="hint">
              With an email, only a person who signs in with that verified email can use the link. Without
              one, anyone with the link can.
            </p>
          </div>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create invite link"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
