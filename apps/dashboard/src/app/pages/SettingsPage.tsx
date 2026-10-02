import { type FormEvent, useEffect, useId, useState } from "react";
import { ApiError, type App, api, errorMessage } from "../api";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { ENVIRONMENT_LABELS, formatDate } from "../format";
import { appEmoji, initials } from "../lib/identity";
import { useSession } from "../session";
import { lastAppId, useApps } from "../shell/context";
import { RoleBadge } from "../ui/Badges";
import { CopyButton } from "../ui/Copy";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { useToast } from "../ui/Toast";

export function SettingsPage() {
  const { me, signOut } = useSession();
  const { apps } = useApps();
  const list = apps.status === "ready" ? apps.data : [];
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <PageHeader title="Settings" lede="Your profile, your apps’ names, your session and your account." />
      <div className="stack-lg">
        <section className="card" aria-label="Profile">
          <div className="profile">
            <span className="avatar avatar-person avatar-xl" aria-hidden="true">
              {initials(me.account.name, me.account.email)}
            </span>
            <div className="profile-text">
              <p className="profile-name">{me.account.name ?? "No name"}</p>
              <p className="hint">{me.account.email ?? "No email on file"}</p>
            </div>
            <RoleBadge value="owner" />
          </div>
          <dl className="facts card-body">
            <div>
              <dt>Sign-in</dt>
              <dd>
                {me.account.githubLinked
                  ? "GitHub. Your name and email follow your GitHub profile."
                  : "Development sign-in (local only)."}
              </dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{formatDate(me.account.createdAt)}</dd>
            </div>
            <div>
              <dt>Account ID</dt>
              <dd className="inline-copy">
                <span className="mono">{me.account.id}</span>
                <CopyButton value={me.account.id} label="Copy the account ID" done="Account ID copied" />
              </dd>
            </div>
          </dl>
        </section>

        {list.length > 0 && <AppSettings apps={list} />}

        <section className="card" aria-label="Session">
          <div className="card-head">
            <div>
              <h2 className="card-title">Session</h2>
              <p className="card-sub">Signing out ends this browser’s session. Your keys keep working.</p>
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await signOut();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="signOut" />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>

        <section className="card" aria-label="Delete account">
          <div className="card-head">
            <div>
              <h2 className="card-title">Delete account</h2>
              <p className="card-sub">
                Deletes your account and everything it owns: apps, keys, custom emoji, tenants, webhooks and
                your team. You cannot undo this.
              </p>
            </div>
            <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
              <Icon name="trash" />
              Delete account…
            </button>
          </div>
        </section>
      </div>
      <DeleteAccountDialog
        open={deleting}
        email={me.account.email}
        onClose={() => setDeleting(false)}
        onDeleted={() => void signOut()}
      />
    </>
  );
}

function AppSettings({ apps }: { apps: App[] }) {
  const { upsert } = useApps();
  const toast = useToast();
  const [appId, setAppId] = useState(
    () => apps.find((app) => app.id === lastAppId())?.id ?? apps[0]?.id ?? "",
  );
  const app = apps.find((item) => item.id === appId) ?? apps[0];
  const [name, setName] = useState(app?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const selectId = useId();
  const nameId = useId();

  useEffect(() => {
    setName(app?.name ?? "");
    setError(null);
  }, [app?.name]);

  if (!app) return null;
  const readOnly = app.role === "viewer" || app.role === "developer";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!app) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateApp(app.id, { name: name.trim() });
      upsert({ ...app, ...updated });
      toast(`Renamed to ${updated.name ?? name.trim()}`);
    } catch (caught) {
      setError({
        message: errorMessage(caught),
        field: caught instanceof ApiError ? caught.field : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="App settings">
      <div className="card-head">
        <div>
          <h2 className="card-title">App</h2>
          <p className="card-sub">Rename an app. Keys and usage stay with it.</p>
        </div>
        <div>
          <label htmlFor={selectId} className="visually-hidden">
            App to edit
          </label>
          <select
            id={selectId}
            className="input"
            value={app.id}
            onChange={(event) => setAppId(event.target.value)}
          >
            {apps.map((item) => (
              <option key={item.id} value={item.id}>
                {appEmoji(item.id)} {item.name} ({item.environment})
              </option>
            ))}
          </select>
        </div>
      </div>
      <form className="card-body form" onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor={nameId} className="label">
            Name
          </label>
          <div className="input-group">
            <input
              id={nameId}
              className="input"
              value={name}
              maxLength={64}
              readOnly={readOnly}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error?.field === "name"}
            />
            {!readOnly && (
              <button
                type="submit"
                className="btn"
                disabled={busy || name.trim() === app.name || !name.trim()}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error.message}
          </p>
        )}
        <dl className="facts">
          <div>
            <dt>App ID</dt>
            <dd className="inline-copy">
              <span className="mono">{app.id}</span>
              <CopyButton value={app.id} label="Copy the app ID" done="App ID copied" />
            </dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>
              {ENVIRONMENT_LABELS[app.environment]}{" "}
              <span className="muted">(fixed when the app is created)</span>
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(app.createdAt)}</dd>
          </div>
        </dl>
      </form>
    </section>
  );
}
