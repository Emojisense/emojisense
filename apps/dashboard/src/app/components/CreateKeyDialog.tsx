import type { KeyKind } from "@emojisense/platform";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { AppSummary, CreatedKeyResponse, KeySummary } from "../../shared/contract";
import { ApiError, api, errorMessage } from "../api";
import { splitOrigins } from "../format";
import { Dialog } from "./Dialog";
import { OriginsField } from "./OriginsField";

interface CreateKeyDialogProps {
  app: AppSummary;
  open: boolean;
  onClose: () => void;
  onCreated: (key: KeySummary) => void;
}

/** Two steps: the form, then the one and only view of the full key. */
export function CreateKeyDialog({ app, open, onClose, onCreated }: CreateKeyDialogProps) {
  const [created, setCreated] = useState<CreatedKeyResponse | null>(null);
  const close = () => {
    setCreated(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={created ? "Copy your key now" : "Create an API key"}
      onClose={close}
      dismissible={created === null}
    >
      {created ? (
        <KeyReveal created={created} onDone={close} />
      ) : (
        <CreateKeyForm
          app={app}
          onCancel={close}
          onCreated={(result) => {
            setCreated(result);
            onCreated(result.key);
          }}
        />
      )}
    </Dialog>
  );
}

interface CreateKeyFormProps {
  app: AppSummary;
  onCancel: () => void;
  onCreated: (result: CreatedKeyResponse) => void;
}

function CreateKeyForm({ app, onCancel, onCreated }: CreateKeyFormProps) {
  const [kind, setKind] = useState<KeyKind>("publishable");
  const [origins, setOrigins] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = kind === "publishable" ? { kind, allowedOrigins: splitOrigins(origins) } : { kind };
      onCreated(await api.createKey(app.id, input));
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
      <fieldset className="choices">
        <legend>Key type</legend>
        <label className="choice">
          <input
            type="radio"
            name="kind"
            value="publishable"
            checked={kind === "publishable"}
            onChange={() => setKind("publishable")}
          />
          <span className="choice-title">Publishable key 🌐</span>
          <span className="hint">
            For browsers and extensions. Send it as <code>?key=</code>. It works only from the allowed
            origins.
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="kind"
            value="secret"
            checked={kind === "secret"}
            onChange={() => setKind("secret")}
          />
          <span className="choice-title">Secret key 🔒</span>
          <span className="hint">
            For servers only: bots, MCP, back ends. Send it as <code>Authorization: Bearer</code>. Never put
            it in a browser.
          </span>
        </label>
      </fieldset>

      {kind === "publishable" && (
        <OriginsField
          value={origins}
          onChange={setOrigins}
          environment={app.environment}
          invalid={error?.field === "allowedOrigins"}
          errorId={error ? errorId : undefined}
        />
      )}

      {error && (
        <p id={errorId} className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Creating…" : "Create key"}
        </button>
      </div>
    </form>
  );
}

function KeyReveal({ created, onDone }: { created: CreatedKeyResponse; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const inputId = useId();
  const warningId = useId();
  const secret = created.key.kind === "secret";

  // The form's submit button is gone, so focus moves to the key itself.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(created.fullKey);
      setCopy("copied");
    } catch {
      setCopy("failed");
      inputRef.current?.select();
    }
  }

  return (
    <>
      <p id={warningId} className="notice notice-warning">
        <strong>Shown once.</strong> This is the only time you can see the full key. We keep only a hash, so
        we cannot show it again. If you lose it, revoke it and create a new one.
      </p>
      <div className="field">
        <label htmlFor={inputId}>Your new {secret ? "secret" : "publishable"} key</label>
        <div className="reveal-row">
          <input
            ref={inputRef}
            id={inputId}
            className="input reveal-key"
            readOnly
            value={created.fullKey}
            spellCheck={false}
            aria-describedby={warningId}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className="button" onClick={copyKey}>
            Copy key
          </button>
        </div>
        <p className="hint" role="status">
          {copy === "copied" && "Copied to the clipboard ✅"}
          {copy === "failed" && "Copy did not work. The key is selected: press Ctrl+C or ⌘C."}
        </p>
      </div>
      <p className="hint">
        {secret ? (
          <>
            Send it from your server as <code>Authorization: Bearer {created.key.prefix}…</code>
          </>
        ) : (
          <>
            Send it as <code>?key={created.key.prefix}…</code> from an allowed origin.
          </>
        )}
      </p>
      <div className="dialog-actions">
        <button type="button" className="button button-primary" onClick={onDone}>
          I have saved the key
        </button>
      </div>
    </>
  );
}
