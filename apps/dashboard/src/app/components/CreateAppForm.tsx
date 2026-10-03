import { type FormEvent, useId, useState } from "react";
import { ApiError, type App, api, errorMessage, isPlanRequired, type PlanId } from "../api";
import { PlanGate } from "../ui/PlanGate";

interface CreateAppFormProps {
  onCreated: (app: App) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** An app is one product. It gets production keys at once; the plan adds dev and staging keys. */
export function CreateAppForm({ onCreated, onCancel, autoFocus }: CreateAppFormProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [requiredPlan, setRequiredPlan] = useState<PlanId | null>(null);
  const nameId = useId();
  const hintId = useId();
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createApp({ name }));
    } catch (caught) {
      if (isPlanRequired(caught)) setRequiredPlan(caught.plan);
      setError({
        message: errorMessage(caught),
        field: caught instanceof ApiError ? caught.field : undefined,
      });
      setBusy(false);
    }
  }

  // Past the plan's app limit the API answers 402: offer the plan with more apps.
  if (requiredPlan) return <PlanGate feature="apps" plan={requiredPlan} compact />;

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={nameId} className="label">
          App name
        </label>
        <input
          id={nameId}
          className="input"
          required
          maxLength={64}
          autoComplete="off"
          placeholder="Relay"
          // biome-ignore lint/a11y/noAutofocus: the dialog opens for this field
          autoFocus={autoFocus}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error?.field === "name"}
          aria-describedby={[hintId, error ? errorId : ""].filter(Boolean).join(" ")}
        />
        <p id={hintId} className="hint">
          Name it after your product. Every app has production keys. Paid plans add development and staging
          keys to the same app.
        </p>
      </div>
      {error && (
        <p id={errorId} className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="btn-row form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create app"}
        </button>
      </div>
    </form>
  );
}
