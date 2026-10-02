import { type FormEvent, useEffect, useId, useState } from "react";
import { ApiError, api, type CustomEmoji, errorMessage, type Tenant } from "../api";
import { formatDate, formatNumber } from "../format";
import { API_URL } from "../lib/config";
import { useResource } from "../lib/useResource";
import { useAppDetail } from "../shell/context";
import { CodeBlock } from "../ui/CodeBlock";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";
import { useToast } from "../ui/Toast";

export function TenantsPage() {
  const { app, readOnly } = useAppDetail();
  const toast = useToast();
  const [tenants, { reload, mutate }] = useResource(`tenants:${app.id}`, () =>
    api.listTenants(app.id).then((data) => data.tenants),
  );
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Tenant | null>(null);
  const previews = useTenantPreviews(app.id);

  const header = (
    <PageHeader
      title="Tenants"
      documentTitle={`Tenants · ${app.name}`}
      lede="Your customers, each with their own custom emoji. Search with a tenant’s ID to add theirs to yours."
      actions={
        tenants.status === "ready" &&
        tenants.data.length > 0 &&
        !readOnly && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Add tenant
          </button>
        )
      }
    />
  );

  if (tenants.status === "plan") {
    return (
      <>
        {header}
        <PlanGate feature="tenants" plan={tenants.plan} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="stack-lg">
        {tenants.status === "loading" && <LoadingState label="Loading tenants…" />}
        {tenants.status === "error" && <ErrorState message={tenants.message} onRetry={reload} />}
        {tenants.status === "ready" && (
          <section className="card" aria-label="Tenants">
            {tenants.data.length === 0 ? (
              <EmptyState
                emoji="🏢"
                title="No tenants yet"
                action={
                  !readOnly && (
                    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                      Add tenant
                    </button>
                  )
                }
              >
                Add one per customer of your product. Their custom emoji stay theirs; yours stay visible to
                all.
              </EmptyState>
            ) : (
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs keyboard access
              <section className="table-wrap" aria-label="Tenants of this app" tabIndex={0}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Tenant</th>
                      <th scope="col">External ID</th>
                      <th scope="col" className="col-num">
                        Custom emoji
                      </th>
                      <th scope="col">Added</th>
                      <th scope="col" className="col-actions">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.data.map((tenant) => (
                      <tr key={tenant.id}>
                        <th scope="row">{tenant.name ?? <span className="muted">Unnamed</span>}</th>
                        <td className="mono">{tenant.externalId}</td>
                        <td className="col-num">
                          <span className="tenant-emoji">
                            <span className="tenant-previews" aria-hidden="true">
                              {previews.get(tenant.id)?.map((emoji) => (
                                <img key={emoji.id} src={emoji.imageUrl} alt="" loading="lazy" />
                              ))}
                            </span>
                            {formatNumber(tenant.emojiCount)}
                          </span>
                        </td>
                        <td className="cell-sub">{formatDate(tenant.createdAt)}</td>
                        <td className="col-actions">
                          {!readOnly && (
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost btn-icon"
                              aria-label={`Delete tenant ${tenant.name ?? tenant.externalId}`}
                              title="Delete tenant"
                              onClick={() => setDeleting(tenant)}
                            >
                              <Icon name="trash" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Use a tenant</h2>
              <p className="card-sub">
                Pass the external ID. Results then include that tenant’s emoji, first and marked{" "}
                <code className="code-inline">source: "custom"</code>.
              </p>
            </div>
          </div>
          <div className="card-body">
            <CodeBlock
              lang="sh"
              label="Tenant search"
              code={`curl "${API_URL}/v1/search?q=launch&tenant=acme-co" \\
  -H "Authorization: Bearer sk_live_…"

# Or create tenants from your back end:
curl -X POST "${API_URL}/v1/tenants" \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{ "externalId": "acme-co", "name": "Acme Co" }'`}
            />
          </div>
        </section>
      </div>

      <CreateTenantDialog
        appId={app.id}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(tenant) => {
          mutate((list) => [tenant, ...list]);
          setCreating(false);
          toast(`Added ${tenant.name ?? tenant.externalId}`);
        }}
      />
      <DeleteTenantDialog
        appId={app.id}
        tenant={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(tenant) => {
          mutate((list) => list.filter((item) => item.id !== tenant.id));
          setDeleting(null);
          toast(`Deleted ${tenant.name ?? tenant.externalId}`);
        }}
      />
    </>
  );
}

/** A few of each tenant's custom emoji, so the list shows whose set is whose. Best effort. */
function useTenantPreviews(appId: string): Map<string, CustomEmoji[]> {
  const [previews, setPreviews] = useState(() => new Map<string, CustomEmoji[]>());
  useEffect(() => {
    let live = true;
    api.listEmoji(appId).then(
      (list) => {
        if (!live) return;
        const byTenant = new Map<string, CustomEmoji[]>();
        for (const emoji of list.emoji) {
          if (!emoji.tenantId) continue;
          const group = byTenant.get(emoji.tenantId) ?? [];
          if (group.length < 4) byTenant.set(emoji.tenantId, [...group, emoji]);
        }
        setPreviews(byTenant);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [appId]);
  return previews;
}

function CreateTenantDialog({
  appId,
  open,
  onClose,
  onCreated,
}: {
  appId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (tenant: Tenant) => void;
}) {
  const [externalId, setExternalId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const externalFieldId = useId();
  const nameFieldId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!externalId.trim()) {
      setError({ message: "Add the ID this customer has in your system.", field: "externalId" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tenant = await api.createTenant(appId, {
        externalId: externalId.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setExternalId("");
      setName("");
      onCreated(tenant);
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
    <Dialog
      open={open}
      title="Add a tenant"
      description="One of your customers, with their own emoji."
      onClose={onClose}
    >
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={externalFieldId} className="label">
            External ID
          </label>
          <input
            id={externalFieldId}
            className="input input-mono"
            value={externalId}
            autoComplete="off"
            spellCheck={false}
            placeholder="acme-co"
            onChange={(event) => setExternalId(event.target.value)}
            aria-invalid={error?.field === "externalId"}
          />
          <p className="hint">The customer’s ID in your own system. Search requests send it as tenant=.</p>
        </div>
        <div className="field">
          <label htmlFor={nameFieldId} className="label">
            Name <span className="label-optional">optional</span>
          </label>
          <input
            id={nameFieldId}
            className="input"
            value={name}
            autoComplete="off"
            placeholder="Acme Co"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error.message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Adding…" : "Add tenant"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteTenantDialog({
  appId,
  tenant,
  onClose,
  onDeleted,
}: {
  appId: string;
  tenant: Tenant | null;
  onClose: () => void;
  onDeleted: (tenant: Tenant) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!tenant) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTenant(appId, tenant.id);
      onDeleted(tenant);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={tenant !== null} title="Delete this tenant?" onClose={onClose}>
      {tenant && (
        <>
          <p>
            <strong>{tenant.name ?? tenant.externalId}</strong> and its {formatNumber(tenant.emojiCount)}{" "}
            custom emoji are deleted for good. Searches with{" "}
            <code className="code-inline">tenant={tenant.externalId}</code> then return only your app-wide
            emoji.
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
              {busy ? "Deleting…" : "Delete tenant"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
