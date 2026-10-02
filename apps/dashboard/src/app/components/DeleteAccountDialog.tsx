import { type FormEvent, useId, useState } from "react";
import { deleteAccountConfirmation, isDeleteAccountConfirmed } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { useAuthAdapter } from "../auth/context";
import { Dialog } from "../ui/Dialog";

interface DeleteAccountDialogProps {
  open: boolean;
  /** The account's email, which the person types to confirm; null when the account has none. */
  email: string | null;
  onClose: () => void;
  /** The account is deleted (and the Clerk user, when Clerk allowed it). Next: sign out. */
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
  const { deleteUser } = useAuthAdapter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInLeft, setSignInLeft] = useState(false);
  const inputId = useId();
  const confirmed = isDeleteAccountConfirmed(email, typed);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof api.deleteAccount>>;
    try {
      result = await api.deleteAccount(typed.trim());
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
      return;
    }
    // The Worker deletes the Clerk user only when it has the secret key; otherwise Clerk JS does.
    if (!result.clerkUserDeleted) {
      try {
        await deleteUser();
      } catch {
        setSignInLeft(true);
        return;
      }
    }
    onDeleted();
  }

  if (signInLeft) {
    return (
      <div className="form">
        <p className="notice notice-warning" role="alert">
          Your Emojisense account and everything it owned are deleted. Your sign-in profile at Clerk (name and
          email) could not be deleted. To delete it, sign in again and delete the new, empty account.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onDeleted}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p>
        This deletes your apps with their API keys, usage and analytics, your custom emoji, tenants and
        webhooks, your team and its invites, your place in other teams, and your sign-in. Apps that use your
        keys stop working within a minute. You cannot undo this.
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
