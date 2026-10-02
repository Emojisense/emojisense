import { type FormEvent, useId, useState } from "react";
import { tryKeyProblem } from "../lib/tryKey";
import { Icon } from "../ui/Icon";

interface TryKeyFieldProps {
  /** The key in use, if any. */
  current: { key: string; source: "pasted" | "created" } | null;
  onUse: (key: string) => void;
  onForget: () => void;
}

/** The key the live search sends to the API: none, one created in this tab, or one pasted here. */
export function TryKeyField({ current, onUse, onForget }: TryKeyFieldProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const key = value.trim();
    const problem = tryKeyProblem(key);
    if (problem) {
      setError(problem);
      return;
    }
    onUse(key);
    setValue("");
    setError(null);
    setOpen(false);
  }

  if (current) {
    return (
      <div className="try-key">
        <Icon name="key" className="try-key-icon" />
        <span>
          Meaning search with <span className="mono">{current.key.slice(0, 12)}…</span>
          <span className="muted">
            {current.source === "created" ? " · created in this tab" : " · kept in this tab only"}
          </span>
        </span>
        {current.source === "pasted" && (
          <button type="button" className="link-button" onClick={onForget}>
            Forget key
          </button>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <div className="try-key">
        <Icon name="key" className="try-key-icon" />
        <span className="muted">Searching on the device only.</span>
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Paste a publishable key
        </button>
        <span className="muted">to try meaning search too.</span>
      </div>
    );
  }

  return (
    <form className="try-key-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="label">
        Publishable key
      </label>
      <div className="input-group">
        <input
          id={inputId}
          className="input input-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="pk_live_…"
          value={value}
          // biome-ignore lint/a11y/noAutofocus: the field opens on request
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={hintId}
        />
        <button type="submit" className="btn">
          Use key
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p id={hintId} className={error ? "notice notice-error" : "hint"} role={error ? "alert" : undefined}>
        {error ??
          "Kept in this browser tab only and sent only to the search API, never to the dashboard. The key must allow this page’s origin."}
      </p>
    </form>
  );
}
