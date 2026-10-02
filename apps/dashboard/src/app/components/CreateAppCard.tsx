import { PLANS } from "@emojisense/platform";
import { type FormEvent, useId, useState } from "react";
import { type AppSummary, ENVIRONMENTS, type Environment } from "../../shared/contract";
import { ApiError, api, errorMessage } from "../api";
import { ENVIRONMENT_LABELS } from "../format";
import { useSession } from "../session";

export function CreateAppCard({ onCreated }: { onCreated: (app: AppSummary) => void }) {
  const { me } = useSession();
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("prod");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const nameId = useId();
  const environmentId = useId();
  const environmentHintId = useId();
  const errorId = useId();
  const { maxApps } = me.plan;
  const atLimit = maxApps !== null && me.appCount >= maxApps;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated((await api.createApp({ name, environment })).app);
    } catch (caught) {
      setError({
        message: errorMessage(caught),
        field: caught instanceof ApiError ? caught.field : undefined,
      });
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <h2 id={headingId} className="section-title">
          New app
        </h2>
      </div>
      <div className="card-body">
        {atLimit ? (
          <p className="hint">
            Your {me.plan.name} plan allows {maxApps} app{maxApps === 1 ? "" : "s"}, and you use all of them.
            {maxApps < PLANS.pro.maxApps &&
              ` Pro allows ${PLANS.pro.maxApps}: join its waitlist in the plan card.`}
          </p>
        ) : (
          <form className="form" onSubmit={submit} noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor={nameId}>App name</label>
                <input
                  id={nameId}
                  className="input"
                  required
                  maxLength={64}
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={error?.field === "name"}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>
              <div className="field">
                <label htmlFor={environmentId}>Environment</label>
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
              Only dev apps may have publishable keys that work from any origin.
            </p>
            {error && (
              <p id={errorId} className="notice notice-error" role="alert">
                {error.message}
              </p>
            )}
            <div className="button-row">
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Creating…" : "Create app"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
