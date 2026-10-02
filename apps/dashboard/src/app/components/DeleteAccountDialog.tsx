import { type FormEvent, useId, useState } from "react";
import { deleteAccountConfirmation, isDeleteAccountConfirmed } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { Dialog } from "../ui/Dialog";

interface DeleteAccountDialogProps {
  open: boolean;
  /** The account's email, which the person types to confirm; null when GitHub shared none. */
  email: string | null;
  onClose: () => void;
  /** The server has deleted the account and cleared the session cookie. */
  onDeleted: () => void;
}

export function DeleteAccountDialog({ open, email, onClose, onDeleted }: DeleteAccountDialogProps) {
  return (
    <Dialog open={open} title="Delete your account?" onClose={onClose}>
      <DeleteAccountConfirm email={email} onCancel={onClose} onDeleted={onDeleted} />
    </Dialog>
  );
}

function DeleteAccountConfirm({
  email,
  onCancel,
  onDeleted,
}: {
  email: string | null;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const confirmed = isDeleteAccountConfirmed(email, typed);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(typed.trim());
      onDeleted();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p>
        This deletes your apps with their API keys, usage and analytics, your custom emoji, tenants and
        webhooks, your team and its invites, and your place in other teams. Apps that use your keys stop
        working within a minute. You cannot undo this.
      </p>
      <div className="field">
        <label htmlFor={inputId} className="label">
          Type <span className="mono">{deleteAccountConfirmation(email)}</span> to confirm
        </label>
        <input
          id={inputId}
          className="input"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {/* Cancel comes first, so the dialog opens with focus on the safe choice. */}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-danger-solid" disabled={!confirmed || busy}>
          {busy ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </form>
  );
}
