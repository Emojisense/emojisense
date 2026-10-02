import { useId, useState } from "react";
import { api, errorMessage, type Webhook, type WebhookDelivery } from "../api";
import { CreateWebhookDialog, EVENT_COPY } from "../components/CreateWebhookDialog";
import { formatDateTime, formatNumber, formatRelative } from "../format";
import { useResource } from "../lib/useResource";
import { useAppDetail } from "../shell/context";
import { StatusBadge } from "../ui/Badges";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";
import { useToast } from "../ui/Toast";

function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export function WebhooksPage() {
  const { app, readOnly } = useAppDetail();
  const toast = useToast();
  const [hooks, { reload, mutate }] = useResource(`webhooks:${app.id}`, () =>
    api.listWebhooks(app.id).then((data) => data.webhooks),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Webhook | null>(null);

  const list = hooks.status === "ready" ? hooks.data : [];
  const selected = list.find((hook) => hook.id === selectedId) ?? list[0] ?? null;

  const header = (
    <PageHeader
      title="Webhooks"
      documentTitle={`Webhooks · ${app.name}`}
      lede="Signed events to your server when custom emoji or tenants change, and when usage nears a limit."
      actions={
        list.length > 0 &&
        !readOnly && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Add endpoint
          </button>
        )
      }
    />
  );

  if (hooks.status === "plan") {
    return (
      <>
        {header}
        <PlanGate feature="webhooks" plan={hooks.plan} />
      </>
    );
  }

  return (
    <>
      {header}
      {hooks.status === "loading" && <LoadingState label="Loading webhooks…" />}
      {hooks.status === "error" && <ErrorState message={hooks.message} onRetry={reload} />}
      {hooks.status === "ready" && list.length === 0 && (
        <div className="card">
          <EmptyState
            emoji="🛰️"
            title="No endpoints yet"
            action={
              !readOnly && (
                <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                  Add endpoint
                </button>
              )
            }
          >
            Add an HTTPS endpoint, and we send it signed events with up to three attempts each.
          </EmptyState>
        </div>
      )}
      {selected && (
        <div className="hooks">
          <nav className="hooks-list" aria-label="Endpoints">
            <ul>
              {list.map((hook) => (
                <li key={hook.id}>
                  <button
                    type="button"
                    className="hook-item"
                    aria-current={hook.id === selected.id ? "true" : undefined}
                    onClick={() => setSelectedId(hook.id)}
                  >
                    <span className="hook-url mono">{hostOf(hook.url)}</span>
                    <span className="hook-meta">
                      <StatusBadge tone={hook.disabledAt ? "idle" : "good"}>
                        {hook.disabledAt ? "Paused" : "Active"}
                      </StatusBadge>
                      <span>
                        {hook.events.length} event{hook.events.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <WebhookDetail
            key={selected.id}
            hook={selected}
            readOnly={readOnly}
            onChange={(updated) =>
              mutate((all) => all.map((hook) => (hook.id === updated.id ? updated : hook)))
            }
            onDelete={() => setDeleting(selected)}
          />
        </div>
      )}

      <CreateWebhookDialog
        appId={app.id}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(hook) => {
          mutate((all) => [hook, ...all]);
          setSelectedId(hook.id);
        }}
      />
      <DeleteWebhookDialog
        hook={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(hook) => {
          mutate((all) => all.filter((item) => item.id !== hook.id));
          setDeleting(null);
          setSelectedId(null);
          toast("Endpoint deleted");
        }}
      />
    </>
  );
}

function WebhookDetail({
  hook,
  readOnly,
  onChange,
  onDelete,
}: {
  hook: Webhook;
  readOnly: boolean;
  onChange: (hook: Webhook) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [deliveries, { reload }] = useResource(`deliveries:${hook.id}`, () =>
    api.listDeliveries(hook.id).then((data) => data.deliveries),
  );
  const [busy, setBusy] = useState<"test" | "toggle" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  async function sendTest() {
    setBusy("test");
    setError(null);
    try {
      const delivery = await api.testWebhook(hook.id);
      toast(
        delivery?.status
          ? `Test sent: HTTP ${delivery.status} in ${delivery.durationMs ?? "?"} ms`
          : "Test sent. Check the delivery log.",
      );
      reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function toggle() {
    setBusy("toggle");
    setError(null);
    try {
      const updated = await api.updateWebhook(hook.id, { disabled: hook.disabledAt === null });
      onChange({ ...hook, ...updated });
      toast(updated.disabledAt ? "Endpoint paused" : "Endpoint resumed");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card hook-detail" aria-labelledby={headingId}>
      <div className="card-head">
        <div className="hook-detail-title">
          <h2 id={headingId} className="card-title mono">
            {hook.url}
          </h2>
          <p className="card-sub">
            Added {formatDateTime(hook.createdAt)}
            {hook.disabledAt ? ` · paused ${formatRelative(hook.disabledAt)}` : ""}
          </p>
        </div>
        {!readOnly && (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null || !!hook.disabledAt}
              onClick={sendTest}
            >
              <Icon name="send" />
              {busy === "test" ? "Sending…" : "Send test event"}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={toggle}>
              {hook.disabledAt ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon"
              aria-label="Delete endpoint"
              title="Delete endpoint"
              onClick={onDelete}
            >
              <Icon name="trash" />
            </button>
          </div>
        )}
      </div>
      <div className="card-body stack">
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <p className="section-label">Events</p>
          <ul className="event-list">
            {hook.events.map((event) => (
              <li key={event}>
                <span className="mono">{event}</span>
                <span className="cell-sub">{EVENT_COPY[event]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="hook-deliveries">
        <div className="hook-deliveries-head">
          <p className="section-label">Recent deliveries</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            <Icon name="refresh" />
            Refresh
          </button>
        </div>
        {deliveries.status === "loading" && <LoadingState label="Loading deliveries…" rows={2} />}
        {deliveries.status === "error" && <ErrorState message={deliveries.message} onRetry={reload} />}
        {deliveries.status === "ready" &&
          (deliveries.data.length === 0 ? (
            <p className="hint hook-empty">No deliveries yet. Send a test event to see one here.</p>
          ) : (
            <DeliveriesTable deliveries={deliveries.data} />
          ))}
      </div>
    </section>
  );
}

function DeliveriesTable({ deliveries }: { deliveries: WebhookDelivery[] }) {
  const [now] = useState(() => Date.now());
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs keyboard access
    <section className="table-wrap" aria-label="Recent deliveries" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Result</th>
            <th scope="col" className="col-num">
              Time
            </th>
            <th scope="col">Sent</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((delivery) => {
            const ok = delivery.status !== null && delivery.status >= 200 && delivery.status < 300;
            return (
              <tr key={delivery.id}>
                <th scope="row" className="mono">
                  {delivery.event}
                </th>
                <td>
                  <StatusBadge tone={ok ? "good" : "bad"}>
                    {delivery.status === null ? "No response" : `HTTP ${delivery.status}`}
                  </StatusBadge>
                </td>
                <td className="col-num">
                  {delivery.durationMs === null ? "—" : `${formatNumber(delivery.durationMs)} ms`}
                </td>
                <td className="cell-sub" title={formatDateTime(delivery.createdAt)}>
                  {formatRelative(delivery.createdAt, now)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function DeleteWebhookDialog({
  hook,
  onClose,
  onDeleted,
}: {
  hook: Webhook | null;
  onClose: () => void;
  onDeleted: (hook: Webhook) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!hook) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteWebhook(hook.id);
      onDeleted(hook);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={hook !== null} title="Delete this endpoint?" onClose={onClose}>
      {hook && (
        <>
          <p>
            <code className="code-inline">{hook.url}</code> stops receiving events right away, and its
            delivery log is deleted. To stop events for a while, pause it instead.
          </p>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={remove}>
              {busy ? "Deleting…" : "Delete endpoint"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
