import type {
  CultureAdminOverview,
  CultureLiveEntry,
  CulturePreview,
  CultureProposal,
  CultureProposalStatus,
} from "@emojisense/platform";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { EntryEditor } from "../components/culture/EntryEditor";
import { PreviewTable } from "../components/culture/PreviewTable";
import { formatDateTime, formatNumber, formatRelative } from "../format";
import { useAdminStatus } from "../lib/admin";
import { describeWhen, type EntryForm, glyphOf, toForm, toRecord } from "../lib/cultureForm";
import { useResource } from "../lib/useResource";
import { StatusBadge } from "../ui/Badges";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { useToast } from "../ui/Toast";
import { NotFoundPage } from "./NotFoundPage";

type Tab = CultureProposalStatus | "live";

/** The live preview waits this long after the last keystroke. */
const PREVIEW_DELAY_MS = 450;

const glyphs = (proposal: { record: CultureProposal["record"] }) =>
  proposal.record.emoji.map((e) => glyphOf(e.hexcode)).join("");

export function CulturePage() {
  const status = useAdminStatus();
  if (status === null) return <LoadingState label="Loading…" rows={2} />;
  // Not an admin: the page does not exist for this account.
  if (!status.admin) return <NotFoundPage />;
  return <CultureReview />;
}

function CultureReview() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("draft");
  const [overview, { reload, mutate }] = useResource(`culture:${tab}`, () =>
    api.cultureOverview(tab === "live" ? undefined : tab),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const data = overview.status === "ready" ? overview.data : null;
  const proposals = data?.proposals ?? [];
  const selected = proposals.find((p) => p.id === selectedId) ?? proposals[0] ?? null;

  async function publish() {
    setPublishing(true);
    try {
      const report = await api.publishCulture();
      toast(
        report.status === "failed"
          ? `Publish failed: ${report.reason ?? "see the logs"}`
          : report.status === "skipped"
            ? `Nothing published: ${report.reason}`
            : report.status === "cleared"
              ? "Nothing live: the deployed files are served"
              : `Published ${report.state?.liveEntries.length ?? 0} live entries`,
        report.status === "failed" ? "⚠️" : "🚀",
      );
      reload();
    } catch (error) {
      toast(errorMessage(error), "⚠️");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Culture"
        eyebrow="Internal"
        lede="AI drafts from rising searches and the holiday calendar. Nothing goes live until an editor approves it."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setExporting(true)}>
              <Icon name="upload" />
              Export to git
            </button>
            <button type="button" className="btn btn-primary" disabled={publishing} onClick={publish}>
              <Icon name="send" />
              {publishing ? "Publishing…" : "Publish now"}
            </button>
          </>
        }
      />
      {data && <PublishState overview={data} />}
      <div className="culture-toolbar">
        <Segmented
          label="Show"
          value={tab}
          onChange={(value) => {
            setTab(value);
            setSelectedId(null);
          }}
          options={[
            { value: "draft", label: `Drafts${data ? ` (${data.counts.draft})` : ""}` },
            { value: "approved", label: `Approved${data ? ` (${data.counts.approved})` : ""}` },
            { value: "rejected", label: `Rejected${data ? ` (${data.counts.rejected})` : ""}` },
            {
              value: "live",
              label: `Live${data ? ` (${data.live.filter((l) => l.status === "approved").length})` : ""}`,
            },
          ]}
        />
      </div>
      {overview.status === "loading" && <LoadingState label="Loading proposals…" rows={4} />}
      {overview.status === "error" && <ErrorState message={overview.message} onRetry={reload} />}
      {data && tab === "live" && <LiveEntries entries={data.live} onChange={reload} />}
      {data && tab !== "live" && proposals.length === 0 && (
        <div className="card">
          <EmptyState emoji="🗓️" title={tab === "draft" ? "No drafts to review" : `Nothing ${tab} yet`}>
            The nightly job drafts entries from rising searches and the next weeks of the holiday calendar.
          </EmptyState>
        </div>
      )}
      {data && tab !== "live" && selected && (
        <div className="hooks culture">
          <nav className="hooks-list" aria-label="Proposals">
            <ul>
              {proposals.map((proposal) => (
                <li key={proposal.id}>
                  <button
                    type="button"
                    className="hook-item"
                    aria-current={proposal.id === selected.id ? "true" : undefined}
                    onClick={() => setSelectedId(proposal.id)}
                  >
                    <span className="culture-item-head">
                      <span className="emoji culture-item-glyphs" aria-hidden="true">
                        {glyphs(proposal)}
                      </span>
                      <span className="hook-url mono">{proposal.entryId}</span>
                    </span>
                    <span className="hook-meta">
                      <span className="badge">{proposal.record.kind}</span>
                      <span>{originLine(proposal)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <ProposalDetail
            key={selected.id}
            proposal={selected}
            onDecided={(updated) => {
              mutate((current) => ({
                ...current,
                proposals: current.proposals.filter((p) => p.id !== updated.id),
                counts: {
                  ...current.counts,
                  [selected.status]: current.counts[selected.status] - 1,
                  [updated.status]: current.counts[updated.status] + 1,
                },
              }));
              setSelectedId(null);
            }}
            onSaved={(updated) =>
              mutate((current) => ({
                ...current,
                proposals: current.proposals.map((p) => (p.id === updated.id ? updated : p)),
              }))
            }
          />
        </div>
      )}
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </>
  );
}

function originLine(proposal: CultureProposal): string {
  const { evidence } = proposal;
  if (evidence.origin === "trend") {
    const top = Math.max(0, ...(evidence.trends ?? []).map((t) => t.score));
    return `Rising ×${top.toFixed(1)} · ${formatRelative(proposal.createdAt)}`;
  }
  return `${evidence.source?.title ?? "Calendar"} · ${evidence.source?.days ?? ""}`;
}

/** What /v1/culture serves now, and whether approvals are waiting for a publish. */
function PublishState({ overview }: { overview: CultureAdminOverview }) {
  const { publish, publishPending } = overview;
  return (
    <section className="card culture-publish" aria-label="Publishing">
      <div className="card-body culture-publish-body">
        <div>
          <p className="section-label">Served now</p>
          {publish?.build ? (
            <p>
              Build <span className="mono">{publish.build}</span> with{" "}
              {formatNumber(publish.liveEntries.length)} live{" "}
              {publish.liveEntries.length === 1 ? "entry" : "entries"}, published{" "}
              {formatRelative(publish.publishedAt)} ({publish.reason}).
            </p>
          ) : (
            <p>The deployed culture files (git entries only).</p>
          )}
        </div>
        <StatusBadge tone={publishPending ? "bad" : "good"}>
          {publishPending ? "Publish pending" : "Up to date"}
        </StatusBadge>
      </div>
      {publish && publish.skipped.length > 0 && (
        <div className="card-foot">
          <p className="hint">
            Left out of the last publish:{" "}
            {publish.skipped.map((s) => (
              <span key={s.id} className="culture-skipped">
                <span className="mono">{s.id}</span> ({s.reason})
              </span>
            ))}
          </p>
        </div>
      )}
    </section>
  );
}

function Evidence({ proposal }: { proposal: CultureProposal }) {
  const { evidence } = proposal;
  return (
    <div className="culture-evidence">
      <p className="section-label">Why it was proposed</p>
      {evidence.origin === "trend" && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Rising searches</caption>
            <thead>
              <tr>
                <th scope="col">Phrase</th>
                <th scope="col">Country</th>
                <th scope="col">Rising</th>
                <th scope="col">Searches (7 days)</th>
              </tr>
            </thead>
            <tbody>
              {(evidence.trends ?? []).map((trend) => (
                <tr key={`${trend.country}:${trend.query}`}>
                  <td className="mono">{trend.query}</td>
                  <td>{trend.country === "*" ? "All" : trend.country}</td>
                  <td>×{trend.score.toFixed(1)}</td>
                  <td>{formatNumber(trend.searches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {evidence.origin === "calendar" && evidence.source && (
        <dl className="facts">
          <div>
            <dt>Calendar</dt>
            <dd>
              {evidence.source.title} · {evidence.source.category}
            </dd>
          </div>
          <div>
            <dt>Days</dt>
            <dd>{evidence.source.days}</dd>
          </div>
          <div>
            <dt>Dates from</dt>
            <dd>{evidence.source.basis}</dd>
          </div>
        </dl>
      )}
      <p className="hint">
        Drafted by <span className="mono">{evidence.model}</span> ({evidence.prompt}). The gate checked{" "}
        {formatNumber(evidence.gate.queries)} queries and {formatNumber(evidence.gate.triggers)} triggers.
        {evidence.droppedTriggers.length > 0 &&
          ` Left out triggers other entries use: ${evidence.droppedTriggers.map((d) => `"${d.trigger}"`).join(", ")}.`}
      </p>
    </div>
  );
}

function ProposalDetail({
  proposal,
  onDecided,
  onSaved,
}: {
  proposal: CultureProposal;
  onDecided: (proposal: CultureProposal) => void;
  onSaved: (proposal: CultureProposal) => void;
}) {
  const toast = useToast();
  const headingId = useId();
  const draft = proposal.status === "draft";
  const [form, setForm] = useState<EntryForm>(() => toForm(proposal.record));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<CulturePreview | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const request = useRef(0);

  // The first preview comes with the proposal; edits are previewed after a short pause.
  useEffect(() => {
    const ticket = ++request.current;
    setPreviewing(true);
    const record = toRecord(form, proposal.record);
    const timer = setTimeout(
      () => {
        const load = dirty
          ? api.culturePreview(record)
          : api.cultureProposal(proposal.id).then((data) => data.preview);
        load.then(
          (result) => {
            if (ticket !== request.current) return;
            setPreview(result);
            setPreviewing(false);
          },
          (caught: unknown) => {
            if (ticket !== request.current) return;
            setError(errorMessage(caught));
            setPreviewing(false);
          },
        );
      },
      dirty ? PREVIEW_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [form, dirty, proposal]);

  const errors = preview?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.level === "warning") ?? [];

  function edit(next: EntryForm) {
    setForm(next);
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updateCultureProposal(proposal.id, toRecord(form, proposal.record));
      onSaved(saved.proposal);
      setPreview(saved.preview);
      setDirty(false);
      toast("Draft saved");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card hook-detail culture-detail" aria-labelledby={headingId}>
      <div className="card-head">
        <div className="hook-detail-title">
          <h2 id={headingId} className="card-title">
            <span className="emoji" aria-hidden="true">
              {glyphs(proposal)}
            </span>{" "}
            <span className="mono">{proposal.entryId}</span>
          </h2>
          <p className="card-sub">
            {describeWhen(proposal.record)} · drafted {formatDateTime(proposal.createdAt)}
            {proposal.reviewedAt &&
              ` · ${proposal.status} by ${proposal.reviewerName ?? "an editor"} ${formatRelative(proposal.reviewedAt)}`}
          </p>
        </div>
        <StatusBadge
          tone={proposal.status === "approved" ? "good" : proposal.status === "rejected" ? "bad" : "idle"}
        >
          {proposal.status === "draft" ? "Draft" : proposal.status === "approved" ? "Approved" : "Rejected"}
        </StatusBadge>
      </div>
      <div className="card-body stack-lg">
        {proposal.reason && (
          <p className="notice">
            <span>
              <strong>Reason:</strong> {proposal.reason}
            </span>
          </p>
        )}
        <Evidence proposal={proposal} />
        <EntryEditor form={form} readOnly={!draft || busy} onChange={edit} />
        <div aria-live="polite">
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          {errors.length > 0 && (
            <div className="notice notice-error culture-issues">
              <p>
                <strong>Fix before approval</strong>
              </p>
              <ul>
                {errors.map((issue) => (
                  <li key={issue.message}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="notice notice-warning culture-issues">
              <ul>
                {warnings.map((issue) => (
                  <li key={issue.message}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>
          <p className="section-label">
            Search preview{" "}
            {previewing && (
              <>
                <span className="spinner" aria-hidden="true" />
                <span className="visually-hidden">Updating</span>
              </>
            )}
          </p>
          <p className="hint">
            Windows are ignored so a December entry can be checked in October. Emoji the entry adds are
            outlined.
          </p>
          {preview ? (
            <PreviewTable preview={preview} busy={previewing} />
          ) : (
            <LoadingState label="Previewing…" />
          )}
        </div>
      </div>
      {draft && (
        <div className="card-foot culture-actions">
          <button type="button" className="btn" disabled={!dirty || busy} onClick={save}>
            Save draft
          </button>
          <span className="culture-actions-spacer" />
          <button type="button" className="btn" disabled={busy} onClick={() => setDeciding("reject")}>
            Reject…
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || previewing || errors.length > 0}
            title={errors.length > 0 ? "Fix the errors first" : undefined}
            onClick={() => setDeciding("approve")}
          >
            <Icon name="check" />
            Approve…
          </button>
        </div>
      )}
      <DecisionDialog
        kind={deciding}
        entryId={form.id}
        onClose={() => setDeciding(null)}
        onSubmit={async (reason) => {
          if (deciding === "approve") {
            const result = await api.approveCultureProposal(proposal.id, {
              ...(reason ? { reason } : {}),
              record: toRecord(form, proposal.record),
            });
            toast(`${result.live.id} is approved. It goes live with the next publish.`, "✅");
            onDecided(result.proposal);
          } else {
            const result = await api.rejectCultureProposal(proposal.id, reason);
            toast(`${proposal.entryId} rejected`);
            onDecided(result.proposal);
          }
          setDeciding(null);
        }}
      />
    </section>
  );
}

function DecisionDialog({
  kind,
  entryId,
  onClose,
  onSubmit,
}: {
  kind: "approve" | "reject" | "retire" | null;
  entryId: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = kind !== "approve";
  const title =
    kind === "approve" ? `Approve ${entryId}` : kind === "reject" ? `Reject ${entryId}` : `Retire ${entryId}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={kind !== null}
      title={title}
      description={
        kind === "approve"
          ? "The entry is checked again, stored as live, and served after the next publish (Publish now, or within 10 minutes)."
          : kind === "reject"
            ? "Rejected ideas are not proposed again. The reason helps the next drafts."
            : "The entry leaves the culture files with the next publish."
      }
      onClose={onClose}
    >
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor={`${id}-reason`}>
            Reason {!required && <span className="label-optional">optional</span>}
          </label>
          <textarea
            id={`${id}-reason`}
            className="input"
            rows={3}
            maxLength={500}
            required={required}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={kind === "approve" ? "btn btn-primary" : "btn btn-danger"}
            disabled={busy || (required && reason.trim() === "")}
          >
            {busy ? "Saving…" : kind === "approve" ? "Approve" : kind === "reject" ? "Reject" : "Retire"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LiveEntries({ entries, onChange }: { entries: CultureLiveEntry[]; onChange: () => void }) {
  const toast = useToast();
  const [retiring, setRetiring] = useState<CultureLiveEntry | null>(null);
  if (entries.length === 0) {
    return (
      <div className="card">
        <EmptyState emoji="🌱" title="No live entries">
          Approved drafts appear here. They are served without a deploy until an export brings them into git.
        </EmptyState>
      </div>
    );
  }
  return (
    <section className="card" aria-label="Live entries">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">Window</th>
              <th scope="col">Approved</th>
              <th scope="col">State</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <span className="emoji" aria-hidden="true">
                    {glyphs(entry)}
                  </span>{" "}
                  <span className="mono">{entry.id}</span>
                </td>
                <td>{describeWhen(entry.record)}</td>
                <td>
                  {entry.reviewerName}, {formatRelative(entry.approvedAt)}
                </td>
                <td>
                  <StatusBadge tone={entry.status === "approved" ? "good" : "idle"}>
                    {entry.status === "retired" ? "Retired" : entry.exportedAt ? "Live, in export" : "Live"}
                  </StatusBadge>
                </td>
                <td className="culture-row-actions">
                  {entry.status === "approved" && (
                    <button type="button" className="btn btn-sm" onClick={() => setRetiring(entry)}>
                      Retire…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DecisionDialog
        kind={retiring ? "retire" : null}
        entryId={retiring?.id ?? ""}
        onClose={() => setRetiring(null)}
        onSubmit={async (reason) => {
          if (!retiring) return;
          await api.retireCultureEntry(retiring.id, reason);
          toast(`${retiring.id} retired. It leaves the files with the next publish.`);
          setRetiring(null);
          onChange();
        }}
      />
    </section>
  );
}

function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [mark, setMark] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const exported = await api.exportCulture(mark);
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "culture-live-export.json";
      link.click();
      URL.revokeObjectURL(url);
      toast(`${exported.entries.length} live entries exported`);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Export live entries to git"
      description="Git stays the long-term record. Download the approved live entries, then write them to packages/data/culture/entries and commit."
      onClose={onClose}
    >
      <div className="form">
        <div className="code">
          <pre>pnpm --filter @emojisense/data culture:import-live --file culture-live-export.json</pre>
        </div>
        <label className="check">
          <input type="checkbox" checked={mark} onChange={(event) => setMark(event.target.checked)} />
          <span className="check-text">Mark them as exported</span>
        </label>
        <p className="hint">
          After the next deploy the git entries are served; their live copies stay as history.
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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={download}>
            {busy ? "Exporting…" : "Download"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
