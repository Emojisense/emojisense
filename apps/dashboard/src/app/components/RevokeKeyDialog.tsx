import { useState } from "react";
import type { KeySummary } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { Dialog } from "./Dialog";

interface RevokeKeyDialogProps {
  /** The key to revoke; `null` keeps the dialog closed. */
  apiKey: KeySummary | null;
  onClose: () => void;
  onRevoked: (key: KeySummary) => void;
}

export function RevokeKeyDialog({ apiKey, onClose, onRevoked }: RevokeKeyDialogProps) {
  return (
    <Dialog open={apiKey !== null} title="Revoke this key?" onClose={onClose}>
      {apiKey && <RevokeConfirm apiKey={apiKey} onCancel={onClose} onRevoked={onRevoked} />}
    </Dialog>
  );
}

function RevokeConfirm({
  apiKey,
  onCancel,
  onRevoked,
}: {
  apiKey: KeySummary;
  onCancel: () => void;
  onRevoked: (key: KeySummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      onRevoked((await api.revokeKey(apiKey.id)).key);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        Requests with <code>{apiKey.prefix}…</code> will fail with <code>401</code> right away. You cannot
        undo this. Create a new key first if an app still uses this one.
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {/* Cancel comes first, so the dialog opens with focus on the safe choice. */}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-danger" onClick={revoke} disabled={busy}>
          {busy ? "Revoking…" : "Revoke key"}
        </button>
      </div>
    </>
  );
}
