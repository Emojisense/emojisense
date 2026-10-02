import { useId } from "react";
import type { Environment } from "../../shared/contract";

interface OriginsFieldProps {
  value: string;
  onChange: (value: string) => void;
  environment: Environment;
  invalid: boolean;
  /** Id of the error message, when there is one. */
  errorId?: string;
}

export function OriginsField({ value, onChange, environment, invalid, errorId }: OriginsFieldProps) {
  const id = useId();
  const hintId = useId();
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");

  return (
    <div className="field">
      <label htmlFor={id}>Allowed origins</label>
      <p id={hintId} className="hint">
        One per line, like <code>https://app.example.com</code> or <code>https://*.example.com</code>. Use{" "}
        <code>http://</code> only for localhost.{" "}
        {environment === "dev"
          ? "Leave it empty to allow any origin (dev apps only)."
          : "Add at least one: only dev apps may allow any origin."}
      </p>
      <textarea
        id={id}
        className="input"
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
      />
    </div>
  );
}
