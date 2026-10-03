import type { PlanId } from "@emojisense/platform";
import { type ReactNode, useRef, useState } from "react";
import type { KeySummary } from "../../shared/contract";
import type { App } from "../api";
import { CreateKeyDialog } from "../components/CreateKeyDialog";
import { EditOriginsDialog } from "../components/EditOriginsDialog";
import { RevokeKeyDialog } from "../components/RevokeKeyDialog";
import { formatDate, isoDate } from "../format";
import {
  countActiveKeys,
  ENVIRONMENT_INFO,
  ENVIRONMENTS,
  type Environment,
  isEnvironment,
  isPaused,
  planHasEnvironment,
} from "../lib/environments";
import { ENVIRONMENT_FEATURE, FEATURE_PLAN } from "../lib/plans";
import { sampleKeys } from "../lib/previewSamples";
import { navigate, useSearchParams } from "../router";
import { appHref } from "../routes";
import { useAppDetail } from "../shell/context";
import { KindBadge, StatusBadge } from "../ui/Badges";
import { EmptyState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { LockedPreview } from "../ui/LockedPreview";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";

/** Same order as the API: active keys first, newest first. */
function sortKeys(keys: KeySummary[]): KeySummary[] {
  return [...keys].sort(
    (a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || b.createdAt - a.createdAt,
  );
}

export function KeysPage() {
  const { app, keys, setKeys, readOnly } = useAppDetail();
  const params = useSearchParams();
  const requested = params.get("env");
  const environment: Environment = isEnvironment(requested) ? requested : "prod";
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KeySummary | null>(null);
  const [revoking, setRevoking] = useState<KeySummary | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const available = planHasEnvironment(app.plan, environment);
  const shown = keys.filter((key) => key.environment === environment);

  function upsert(key: KeySummary) {
    setKeys(sortKeys([key, ...keys.filter((existing) => existing.id !== key.id)]));
  }

  function select(next: Environment) {
    const query = next === "prod" ? "" : `?env=${next}`;
    navigate(`${appHref(app.id, "keys")}${query}`, { replace: true });
  }

  const createButton = available && (
    <button type="button" className="btn btn-primary" disabled={readOnly} onClick={() => setCreating(true)}>
      <Icon name="plus" />
      Create {environment} key
    </button>
  );

  return (
    <>
      <PageHeader
        title="API keys"
        documentTitle={`Keys · ${app.name}`}
        lede="Publishable keys go in browsers and extensions. Secret keys stay on your servers."
        actions={shown.length > 0 && createButton}
      />

      <div className="stack-lg">
        <EnvironmentTabs app={app} keys={keys} value={environment} onChange={select} />

        <div id="keys-panel" role="tabpanel" aria-labelledby={`keys-tab-${environment}`} className="stack">
          {!available && shown.length === 0 ? (
            <LockedPreview feature={ENVIRONMENT_FEATURE[environment] ?? "dev_keys"}>
              <section className="card" aria-label="Sample keys">
                <KeysTable
                  appName={app.name}
                  keys={sampleKeys(app.id, environment)}
                  plan={FEATURE_PLAN[ENVIRONMENT_FEATURE[environment] ?? "dev_keys"]}
                  readOnly
                  onEdit={() => undefined}
                  onRevoke={() => undefined}
                />
              </section>
            </LockedPreview>
          ) : (
            <>
              {!available && <PlanGate feature={ENVIRONMENT_FEATURE[environment] ?? "dev_keys"} compact />}
              <p className="env-intro">
                <span className="emoji" aria-hidden="true">
                  {ENVIRONMENT_INFO[environment].emoji}
                </span>
                {!available
                  ? `These ${environment} keys are paused: the API answers 402 until the plan includes ${ENVIRONMENT_INFO[environment].label.toLowerCase()} again. Prod keys keep working.`
                  : ENVIRONMENT_INFO[environment].text}
              </p>
              <section className="card" aria-label={`${ENVIRONMENT_INFO[environment].label} keys`}>
                {shown.length === 0 ? (
                  <EmptyState emoji="🔑" title={`No ${environment} keys yet`} action={createButton}>
                    Create a publishable key for browsers and extensions, or a secret key for servers.
                  </EmptyState>
                ) : (
                  <div ref={tableRef}>
                    <KeysTable
                      appName={app.name}
                      keys={shown}
                      plan={app.plan}
                      readOnly={readOnly}
                      onEdit={setEditing}
                      onRevoke={setRevoking}
                    />
                  </div>
                )}
              </section>
            </>
          )}
        </div>

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

      <CreateKeyDialog
        app={app}
        environment={environment}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={upsert}
      />
      <EditOriginsDialog
        apiKey={editing}
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

interface EnvironmentTabsProps {
  app: App;
  keys: KeySummary[];
  value: Environment;
  onChange: (environment: Environment) => void;
}

/** Tabs, not a filter: each environment is its own set of keys. Locked ones open a preview. */
function EnvironmentTabs({ app, keys, value, onChange }: EnvironmentTabsProps) {
  const counts = countActiveKeys(keys);
  return (
    <div className="env-tabs" role="tablist" aria-label="Environment">
      {ENVIRONMENTS.map((environment, index) => {
        const locked = !planHasEnvironment(app.plan, environment);
        const selected = environment === value;
        return (
          <button
            key={environment}
            id={`keys-tab-${environment}`}
            type="button"
            role="tab"
            className="env-tab"
            aria-selected={selected}
            aria-controls="keys-panel"
            tabIndex={selected ? 0 : -1}
            data-locked={locked || undefined}
            onClick={() => onChange(environment)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const step = event.key === "ArrowRight" ? 1 : ENVIRONMENTS.length - 1;
              const next = ENVIRONMENTS[(index + step) % ENVIRONMENTS.length];
              if (!next) return;
              onChange(next);
              document.getElementById(`keys-tab-${next}`)?.focus();
            }}
          >
            <span className="emoji env-tab-emoji" aria-hidden="true">
              {ENVIRONMENT_INFO[environment].emoji}
            </span>
            {ENVIRONMENT_INFO[environment].label}
            {locked ? (
              <Icon name="lock" className="env-tab-lock" />
            ) : (
              <span className="env-tab-count">{counts[environment]}</span>
            )}
          </button>
        );
      })}
    </div>
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
  plan: PlanId;
  readOnly: boolean;
  onEdit: (key: KeySummary) => void;
  onRevoke: (key: KeySummary) => void;
}

function KeysTable({ appName, keys, plan, readOnly, onEdit, onRevoke }: KeysTableProps) {
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
            <KeyRow
              key={key.id}
              apiKey={key}
              paused={isPaused(key, plan)}
              readOnly={readOnly}
              onEdit={onEdit}
              onRevoke={onRevoke}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OriginsCell({ apiKey }: { apiKey: KeySummary }) {
  if (apiKey.kind === "secret") return <span className="cell-sub">Servers only</span>;
  if (apiKey.allowedOrigins.length === 0) return <span className="cell-sub">Any origin</span>;
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
  paused,
  readOnly,
  onEdit,
  onRevoke,
}: {
  apiKey: KeySummary;
  paused: boolean;
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
          <StatusBadge tone={revoked || paused ? "idle" : "good"}>
            {revoked ? "Revoked" : paused ? "Paused" : "Active"}
          </StatusBadge>
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
