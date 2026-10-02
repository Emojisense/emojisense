import { type FormEvent, useId, useState } from "react";
import { api, type EmojiImportResponse, errorMessage, isPlanRequired, type PlanId } from "../../api";
import { formatNumber } from "../../format";
import { FEATURE_PLAN, planIncludes } from "../../lib/plans";
import { Dialog } from "../../ui/Dialog";
import { PlanGate } from "../../ui/PlanGate";

export type ImportSource = "slack" | "discord";

interface ImportDialogProps {
  appId: string;
  /** The app's plan (its owner's). */
  plan: PlanId;
  source: ImportSource | null;
  onImported: () => void;
  onClose: () => void;
}

const TITLES: Record<ImportSource, string> = {
  slack: "Import from Slack",
  discord: "Import from Discord",
};

export function ImportDialog({ appId, plan, source, onImported, onClose }: ImportDialogProps) {
  return (
    <Dialog
      open={source !== null}
      title={source ? TITLES[source] : "Import"}
      description="We use the token once to copy the emoji, then forget it. It is never stored or logged."
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

function ImportForm({
  appId,
  plan,
  source,
  onImported,
  onClose,
}: ImportDialogProps & { source: ImportSource }) {
  const [token, setToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiredPlan, setRequiredPlan] = useState<PlanId | null>(
    planIncludes(plan, "emoji_import") ? null : FEATURE_PLAN.emoji_import,
  );
  const [result, setResult] = useState<EmojiImportResponse | null>(null);
  const tokenId = useId();
  const tokenHintId = useId();
  const guildFieldId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim() || (source === "discord" && !guildId.trim())) {
      setError(source === "slack" ? "Paste a Slack user token." : "Paste a bot token and the server ID.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const imported =
        source === "slack"
          ? await api.importSlack(appId, token.trim())
          : await api.importDiscord(appId, { botToken: token.trim(), guildId: guildId.trim() });
      setToken("");
      setResult(imported);
      onImported();
    } catch (caught) {
      if (isPlanRequired(caught)) setRequiredPlan(caught.plan);
      else setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (requiredPlan) return <PlanGate feature="emoji_import" plan={requiredPlan} compact />;

  if (result) {
    return (
      <>
        <div className="import-result">
          <span className="emoji" aria-hidden="true">
            📦
          </span>
          <p role="status">
            <strong>
              Imported {formatNumber(result.imported)} emoji
              {result.skipped > 0 ? `, skipped ${formatNumber(result.skipped)}` : ""}.
            </strong>
            {result.skipped > 0 && (
              <span className="hint"> Aliases of aliases and emoji over your plan’s limit are skipped.</span>
            )}
          </p>
        </div>
        <div className="dialog-actions">
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
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Importing…" : "Import emoji"}
        </button>
      </div>
    </form>
  );
}
