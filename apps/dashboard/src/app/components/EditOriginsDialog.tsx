import { type FormEvent, useId, useState } from "react";
import type { Environment, KeySummary } from "../../shared/contract";
import { ApiError, api, errorMessage } from "../api";
import { splitOrigins } from "../format";
import { Dialog } from "../ui/Dialog";
import { OriginsField } from "./OriginsField";

interface EditOriginsDialogProps {
  /** The key being edited; `null` keeps the dialog closed. */
  apiKey: KeySummary | null;
  environment: Environment;
  onClose: () => void;
  onSaved: (key: KeySummary) => void;
}

export function EditOriginsDialog({ apiKey, environment, onClose, onSaved }: EditOriginsDialogProps) {
  return (
    <Dialog open={apiKey !== null} title="Edit allowed origins" onClose={onClose}>
      {apiKey && (
        <EditOriginsForm apiKey={apiKey} environment={environment} onCancel={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

interface EditOriginsFormProps {
  apiKey: KeySummary;
  environment: Environment;
  onCancel: () => void;
  onSaved: (key: KeySummary) => void;
}

function EditOriginsForm({ apiKey, environment, onCancel, onSaved }: EditOriginsFormProps) {
  const [origins, setOrigins] = useState(apiKey.allowedOrigins.join("\n"));
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved((await api.updateKeyOrigins(apiKey.id, splitOrigins(origins))).key);
    } catch (caught) {
      setError({
        message: errorMessage(caught),
        field: caught instanceof ApiError ? caught.field : undefined,
      });
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p>
        Key <code className="code-inline">{apiKey.prefix}…</code> answers only browser requests whose{" "}
        <code className="code-inline">Origin</code> is in this list.
      </p>
      <OriginsField
        value={origins}
        onChange={setOrigins}
        environment={environment}
        invalid={error?.field === "allowedOrigins"}
        errorId={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save origins"}
        </button>
      </div>
    </form>
  );
}
