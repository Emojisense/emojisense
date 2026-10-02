import { type ReactNode, useRef, useState } from "react";
import type { KeySummary } from "../../shared/contract";
import { CreateKeyDialog } from "../components/CreateKeyDialog";
import { EditOriginsDialog } from "../components/EditOriginsDialog";
import { RevokeKeyDialog } from "../components/RevokeKeyDialog";
import { formatDate, isoDate } from "../format";
import { useAppDetail } from "../shell/context";
import { KindBadge, StatusBadge } from "../ui/Badges";
import { EmptyState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";

/** Same order as the API: active keys first, newest first. */
function sortKeys(keys: KeySummary[]): KeySummary[] {
  return [...keys].sort(
    (a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || b.createdAt - a.createdAt,
  );
}

export function KeysPage() {
  const { app, keys, setKeys, readOnly } = useAppDetail();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KeySummary | null>(null);
  const [revoking, setRevoking] = useState<KeySummary | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  function upsert(key: KeySummary) {
    setKeys(sortKeys([key, ...keys.filter((existing) => existing.id !== key.id)]));
  }

  const createButton = (
    <button type="button" className="btn btn-primary" disabled={readOnly} onClick={() => setCreating(true)}>
      <Icon name="plus" />
      Create key
    </button>
  );

  return (
    <>
      <PageHeader
        title="API keys"
        documentTitle={`Keys · ${app.name}`}
        lede="Publishable keys go in browsers and extensions. Secret keys stay on your servers."
        actions={keys.length > 0 && createButton}
      />

      <div className="stack-lg">
        <section className="card" aria-label="Keys">
          {keys.length === 0 ? (
            <EmptyState emoji="🔑" title="No keys yet" action={createButton}>
              Create a publishable key for browsers and extensions, or a secret key for servers.
            </EmptyState>
          ) : (
            <div ref={tableRef}>
              <KeysTable
                appName={app.name}
                keys={keys}
                readOnly={readOnly}
                onEdit={setEditing}
                onRevoke={setRevoking}
              />
            </div>
          )}
        </section>

        <div className="grid-2">
          <KeyKindCard
            emoji="🌐"
            title="Publishable keys"
            text={
              <>
                Send as <code className="code-inline">?key=pk_live_…</code>. They answer only the origins you
                allow, so they are safe in a page or an extension.
              </>
            }
          />
          <KeyKindCard
            emoji="🔒"
            title="Secret keys"
            text={
              <>
                Send as <code className="code-inline">Authorization: Bearer sk_live_…</code> from servers,
                bots and MCP. The API refuses them from a browser.
              </>
            }
          />
        </div>
      </div>

      <CreateKeyDialog app={app} open={creating} onClose={() => setCreating(false)} onCreated={upsert} />
      <EditOriginsDialog
        apiKey={editing}
        environment={app.environment}
        onClose={() => setEditing(null)}
        onSaved={(key) => {
          upsert(key);
          setEditing(null);
        }}
      />
      <RevokeKeyDialog
        apiKey={revoking}
        onClose={() => setRevoking(null)}
        onRevoked={(key) => {
          upsert(key);
          setRevoking(null);
          // The Revoke button that opened the dialog is gone; keep focus near the table.
          tableRef.current?.querySelector<HTMLElement>(".table-wrap")?.focus();
        }}
      />
    </>
  );
}

function KeyKindCard({ emoji, title, text }: { emoji: string; title: string; text: ReactNode }) {
  return (
    <div className="card info-card">
      <span className="avatar emoji" aria-hidden="true">
        {emoji}
      </span>
      <div>
        <h2 className="card-title">{title}</h2>
        <p className="hint">{text}</p>
      </div>
    </div>
  );
}

interface KeysTableProps {
  appName: string;
  keys: KeySummary[];
  readOnly: boolean;
  onEdit: (key: KeySummary) => void;
  onRevoke: (key: KeySummary) => void;
}

function KeysTable({ appName, keys, readOnly, onEdit, onRevoke }: KeysTableProps) {
  return (
    // A focusable region, so keyboard users can scroll the table sideways on small screens.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs keyboard access
    <section className="table-wrap" aria-label={`API keys of ${appName}`} tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Type</th>
            <th scope="col">Allowed origins</th>
            <th scope="col">Status</th>
            <th scope="col" className="col-actions">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <KeyRow key={key.id} apiKey={key} readOnly={readOnly} onEdit={onEdit} onRevoke={onRevoke} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OriginsCell({ apiKey }: { apiKey: KeySummary }) {
  if (apiKey.kind === "secret") return <span className="cell-sub">Servers only</span>;
  if (apiKey.allowedOrigins.length === 0) return <span className="cell-sub">Any origin (dev)</span>;
  return (
    <ul className="origin-list">
      {apiKey.allowedOrigins.map((origin) => (
        <li key={origin} className="mono">
          {origin}
        </li>
      ))}
    </ul>
  );
}

function KeyRow({
  apiKey,
  readOnly,
  onEdit,
  onRevoke,
}: {
  apiKey: KeySummary;
  readOnly: boolean;
  onEdit: (key: KeySummary) => void;
  onRevoke: (key: KeySummary) => void;
}) {
  const revoked = apiKey.revokedAt !== null;
  const label = `${apiKey.prefix}…`;
  return (
    <tr data-muted={revoked || undefined}>
      <th scope="row" className="mono key-prefix">
        {label}
      </th>
      <td>
        <KindBadge kind={apiKey.kind} />
      </td>
      <td>
        <OriginsCell apiKey={apiKey} />
      </td>
      <td>
        <div className="cell-stack">
          <StatusBadge tone={revoked ? "idle" : "good"}>{revoked ? "Revoked" : "Active"}</StatusBadge>
          <span className="cell-sub">
            {revoked && apiKey.revokedAt !== null ? (
              <>
                Revoked <time dateTime={isoDate(apiKey.revokedAt)}>{formatDate(apiKey.revokedAt)}</time>
              </>
            ) : (
              <>
                Created <time dateTime={isoDate(apiKey.createdAt)}>{formatDate(apiKey.createdAt)}</time>
              </>
            )}
          </span>
        </div>
      </td>
      <td className="col-actions">
        {!revoked && !readOnly && (
          <div className="btn-row row-actions">
            {apiKey.kind === "publishable" && (
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Edit origins of ${label}`}
                onClick={() => onEdit(apiKey)}
              >
                Edit origins
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-danger"
              aria-label={`Revoke ${label}`}
              onClick={() => onRevoke(apiKey)}
            >
              Revoke
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
