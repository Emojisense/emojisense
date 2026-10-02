import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, type EmojiImportSkipReason, errorMessage, isPlanRequired, type PlanId } from "../../api";
import { formatNumber } from "../../format";
import { type ImportProgress, importAll, importPercent } from "../../lib/emojiImport";
import { FEATURE_PLAN, planIncludes } from "../../lib/plans";
import { Dialog } from "../../ui/Dialog";
import { PlanGate } from "../../ui/PlanGate";

export type ImportSource = "slack" | "discord";

interface ImportDialogProps {
  appId: string;
  /** The app's plan (its owner's). */
  plan: PlanId;
  source: ImportSource | null;
  /** Called once an import run stored new emoji, also when it stopped early. */
  onImported: () => void;
  onClose: () => void;
}

const PROVIDER: Record<ImportSource, string> = { slack: "Slack", discord: "Discord" };

const SKIP_COPY: Record<EmojiImportSkipReason, string> = {
  exists: "already in this app",
  alias: "aliases of other emoji",
  invalid: "with a name or image that breaks the upload rules",
  limit: "over your plan’s limit",
  failed: "that did not download",
};

export function ImportDialog({ appId, plan, source, onImported, onClose }: ImportDialogProps) {
  return (
    <Dialog
      open={source !== null}
      title={source ? `Import from ${PROVIDER[source]}` : "Import"}
      description="We use the token only while the import runs. It is never stored or logged."
      onClose={onClose}
    >
      {source && (
        <ImportForm
          key={source}
          appId={appId}
          plan={plan}
          source={source}
          onImported={onImported}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

type Phase = "form" | "running" | "done";

function ImportForm({
  appId,
  plan,
  source,
  onImported,
  onClose,
}: ImportDialogProps & { source: ImportSource }) {
  const [token, setToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiredPlan, setRequiredPlan] = useState<PlanId | null>(
    planIncludes(plan, "emoji_import") ? null : FEATURE_PLAN.emoji_import,
  );
  const run = useRef<AbortController | null>(null);
  const tokenId = useId();
  const tokenHintId = useId();
  const guildFieldId = useId();

  // Closing the dialog stops the import after the call in flight.
  useEffect(() => () => run.current?.abort(), []);

  function importBatch() {
    return source === "slack"
      ? api.importSlack(appId, token.trim())
      : api.importDiscord(appId, { botToken: token.trim(), guildId: guildId.trim() });
  }

  /** One run: batch after batch while emoji remain. `from` continues a run that stopped. */
  async function start(from: ImportProgress | null) {
    const controller = new AbortController();
    run.current = controller;
    setPhase("running");
    setStopping(false);
    setError(null);
    let latest = from;
    try {
      latest = await importAll(importBatch, {
        from,
        signal: controller.signal,
        onProgress: (next) => {
          latest = next;
          setProgress(next);
        },
      });
      if (latest.remaining === 0) setToken("");
      setPhase("done");
    } catch (caught) {
      if (isPlanRequired(caught)) setRequiredPlan(caught.plan);
      else setError(errorMessage(caught));
      setPhase(latest ? "done" : "form");
    } finally {
      if ((latest?.imported ?? 0) > (from?.imported ?? 0)) onImported();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim() || (source === "discord" && !guildId.trim())) {
      setError(source === "slack" ? "Paste a Slack user token." : "Paste a bot token and the server ID.");
      return;
    }
    void start(null);
  }

  function stop() {
    setStopping(true);
    run.current?.abort();
  }

  if (requiredPlan) return <PlanGate feature="emoji_import" plan={requiredPlan} compact />;

  if (phase === "running") {
    return <ImportRunning source={source} progress={progress} stopping={stopping} onStop={stop} />;
  }

  if (phase === "done" && progress) {
    return (
      <>
        <ImportSummary progress={progress} />
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {(progress.remaining > 0 || error) && (
            <button type="button" className="btn" onClick={() => void start(progress)}>
              Continue import
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={tokenId} className="label">
          {source === "slack" ? "Slack user token" : "Discord bot token"}
        </label>
        <input
          id={tokenId}
          className="input input-mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={source === "slack" ? "xoxp-…" : "MTA…"}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          aria-describedby={tokenHintId}
        />
        <p id={tokenHintId} className="hint">
          {source === "slack"
            ? "A user token with the emoji:read scope, from a Slack app in your workspace."
            : "A bot that is a member of the server. It needs no permissions beyond reading the server’s emoji."}
        </p>
      </div>
      {source === "discord" && (
        <div className="field">
          <label htmlFor={guildFieldId} className="label">
            Server ID
          </label>
          <input
            id={guildFieldId}
            className="input input-mono"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1023456789012345678"
            value={guildId}
            onChange={(event) => setGuildId(event.target.value)}
          />
          <p className="hint">
            In Discord: Developer Mode on, then right-click the server and Copy Server ID.
          </p>
        </div>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Import emoji
        </button>
      </div>
    </form>
  );
}

function ImportRunning({
  source,
  progress,
  stopping,
  onStop,
}: {
  source: ImportSource;
  progress: ImportProgress | null;
  stopping: boolean;
  onStop: () => void;
}) {
  const labelId = useId();
  const percent = progress ? importPercent(progress) : null;
  const total = progress ? progress.imported + progress.remaining : 0;
  return (
    <>
      <div className="import-progress">
        <p id={labelId} role="status">
          {progress
            ? `Imported ${formatNumber(progress.imported)} of ${formatNumber(total)} emoji…`
            : `Reading the emoji list from ${PROVIDER[source]}…`}
        </p>
        <div
          className="meter-track"
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          data-indeterminate={percent === null || undefined}
        >
          <div className="meter-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <p className="hint">
          The import stores up to 50 emoji per step. Keep this dialog open until it ends.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={stopping} onClick={onStop}>
          {stopping ? "Stopping…" : "Stop import"}
        </button>
      </div>
    </>
  );
}

function ImportSummary({ progress }: { progress: ImportProgress }) {
  const reasons = (Object.keys(SKIP_COPY) as EmojiImportSkipReason[])
    .filter((reason) => progress.skippedBy[reason] > 0)
    .map((reason) => `${formatNumber(progress.skippedBy[reason])} ${SKIP_COPY[reason]}`);
  return (
    <div className="import-result">
      <span className="emoji" aria-hidden="true">
        📦
      </span>
      <div className="import-result-text">
        <p role="status">
          <strong>
            Imported {formatNumber(progress.imported)} emoji{progress.remaining > 0 ? " so far" : ""}.
          </strong>
        </p>
        {progress.skipped > 0 && (
          <p className="hint">
            Skipped {formatNumber(progress.skipped)}: {reasons.join(", ")}.
          </p>
        )}
        {progress.remaining > 0 && (
          <p className="hint">{formatNumber(progress.remaining)} more wait. Continue to import them.</p>
        )}
      </div>
    </div>
  );
}
