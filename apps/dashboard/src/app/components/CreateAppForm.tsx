import { type FormEvent, useId, useState } from "react";
import { ENVIRONMENTS, type Environment } from "../../shared/contract";
import { ApiError, type App, api, errorMessage, isPlanRequired, type PlanId } from "../api";
import { ENVIRONMENT_LABELS } from "../format";
import { PlanGate } from "../ui/PlanGate";

interface CreateAppFormProps {
  onCreated: (app: App) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

export function CreateAppForm({ onCreated, onCancel, autoFocus }: CreateAppFormProps) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("prod");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [requiredPlan, setRequiredPlan] = useState<PlanId | null>(null);
  const nameId = useId();
  const environmentId = useId();
  const environmentHintId = useId();
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createApp({ name, environment }));
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
      <div className="field-row">
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
            aria-describedby={error ? errorId : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor={environmentId} className="label">
            Environment
          </label>
          <select
            id={environmentId}
            className="input"
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as Environment)}
            aria-describedby={environmentHintId}
          >
            {ENVIRONMENTS.map((option) => (
              <option key={option} value={option}>
                {ENVIRONMENT_LABELS[option]} ({option})
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id={environmentHintId} className="hint">
        Use one app per environment, so test traffic never counts against production. Only dev apps may have
        keys that work from any origin.
      </p>
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
