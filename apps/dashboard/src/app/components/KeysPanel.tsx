import { useId, useRef, useState } from "react";
import type { AppSummary, KeySummary } from "../../shared/contract";
import { formatDate, isoDate } from "../format";
import { CreateKeyDialog } from "./CreateKeyDialog";
import { EditOriginsDialog } from "./EditOriginsDialog";
import { EmptyState } from "./EmptyState";
import { KindPill } from "./Pills";
import { RevokeKeyDialog } from "./RevokeKeyDialog";

/** Same order as the API: active keys first, newest first. */
function sortKeys(keys: KeySummary[]): KeySummary[] {
  return [...keys].sort(
    (a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || b.createdAt - a.createdAt,
  );
}

interface KeysPanelProps {
  app: AppSummary;
  keys: KeySummary[];
  onKeysChange: (keys: KeySummary[]) => void;
}

export function KeysPanel({ app, keys, onKeysChange }: KeysPanelProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KeySummary | null>(null);
  const [revoking, setRevoking] = useState<KeySummary | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  function upsert(key: KeySummary) {
    onKeysChange(sortKeys([key, ...keys.filter((existing) => existing.id !== key.id)]));
  }

  const createButton = (
    <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
      Create key
    </button>
  );

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <h2 id={headingId} ref={headingRef} className="section-title" tabIndex={-1}>
          API keys
        </h2>
        {keys.length > 0 && createButton}
      </div>
      {keys.length === 0 ? (
        <div className="card-body">
          <EmptyState emoji="🔑" title="No keys yet" action={createButton}>
            Create a publishable key for browsers and extensions, or a secret key for servers.
          </EmptyState>
        </div>
      ) : (
        <KeysTable appName={app.name} keys={keys} onEdit={setEditing} onRevoke={setRevoking} />
      )}

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
          // The Revoke button that opened the dialog is gone; keep focus in the keys section.
          headingRef.current?.focus();
        }}
      />
    </section>
  );
}

interface KeysTableProps {
  appName: string;
  keys: KeySummary[];
  onEdit: (key: KeySummary) => void;
  onRevoke: (key: KeySummary) => void;
}

function KeysTable({ appName, keys, onEdit, onRevoke }: KeysTableProps) {
  const captionId = useId();
  return (
    // A labelled region that takes focus, so keyboard users can scroll the table sideways on
    // small screens.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs keyboard access
    <section className="table-scroll" aria-labelledby={captionId} tabIndex={0}>
      <table className="table">
        <caption id={captionId} className="visually-hidden">
          API keys of {appName}
        </caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Type</th>
            <th scope="col" className="col-origins">
              Allowed origins
            </th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <KeyRow key={key.id} apiKey={key} onEdit={onEdit} onRevoke={onRevoke} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OriginsCell({ apiKey }: { apiKey: KeySummary }) {
  if (apiKey.kind === "secret") return <span className="hint">Servers only</span>;
  if (apiKey.allowedOrigins.length === 0) return <span>Any origin (dev)</span>;
  return (
    <ul className="origin-list">
      {apiKey.allowedOrigins.map((origin) => (
        <li key={origin}>{origin}</li>
      ))}
    </ul>
  );
}

function KeyRow({
  apiKey,
  onEdit,
  onRevoke,
}: {
  apiKey: KeySummary;
  onEdit: (key: KeySummary) => void;
  onRevoke: (key: KeySummary) => void;
}) {
  const revoked = apiKey.revokedAt !== null;
  const label = `${apiKey.prefix}…`;
  return (
    <tr data-revoked={revoked || undefined}>
      <th scope="row" className="key-prefix">
        {label}
      </th>
      <td>
        <KindPill kind={apiKey.kind} />
      </td>
      <td>
        <OriginsCell apiKey={apiKey} />
      </td>
      <td>
        <div className="cell-stack">
          <span className="pill" data-tone={revoked ? "revoked" : "active"}>
            {revoked ? "Revoked" : "Active"}
          </span>
          <span className="hint">
            Created <time dateTime={isoDate(apiKey.createdAt)}>{formatDate(apiKey.createdAt)}</time>
          </span>
          {apiKey.revokedAt !== null && (
            <span className="hint">
              Revoked <time dateTime={isoDate(apiKey.revokedAt)}>{formatDate(apiKey.revokedAt)}</time>
            </span>
          )}
        </div>
      </td>
      <td className="cell-actions">
        {!revoked && (
          <div className="button-row">
            {apiKey.kind === "publishable" && (
              <button
                type="button"
                className="button button-small"
                aria-label={`Edit origins of ${label}`}
                onClick={() => onEdit(apiKey)}
              >
                Edit origins
              </button>
            )}
            <button
              type="button"
              className="button button-small"
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
