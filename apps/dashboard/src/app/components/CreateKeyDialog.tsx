import type { KeyKind } from "@emojisense/platform";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { AppSummary, CreatedKeyResponse, KeySummary } from "../../shared/contract";
import { ApiError, api, errorMessage } from "../api";
import { splitOrigins } from "../format";
import { ENVIRONMENT_INFO, type Environment } from "../lib/environments";
import { rememberKey } from "../lib/sessionKeys";
import { Dialog } from "../ui/Dialog";
import { OriginsField } from "./OriginsField";

interface CreateKeyDialogProps {
  app: AppSummary;
  environment: Environment;
  open: boolean;
  onClose: () => void;
  onCreated: (key: KeySummary) => void;
}

/** Two steps: the form, then the one and only view of the full key. */
export function CreateKeyDialog({ app, environment, open, onClose, onCreated }: CreateKeyDialogProps) {
  const [created, setCreated] = useState<CreatedKeyResponse | null>(null);
  const close = () => {
    setCreated(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={
        created ? "Copy your key now" : `Create a ${ENVIRONMENT_INFO[environment].label.toLowerCase()} key`
      }
      description={created ? undefined : `For ${app.name}. ${ENVIRONMENT_INFO[environment].text}`}
      onClose={close}
      dismissible={created === null}
    >
      {created ? (
        <KeyReveal created={created} onDone={close} />
      ) : (
        <CreateKeyForm
          app={app}
          environment={environment}
          onCancel={close}
          onCreated={(result) => {
            rememberKey(result.key.id, result.fullKey);
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
  environment: Environment;
  onCancel: () => void;
  onCreated: (result: CreatedKeyResponse) => void;
}

function CreateKeyForm({ app, environment, onCancel, onCreated }: CreateKeyFormProps) {
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
      const input =
        kind === "publishable"
          ? { kind, environment, allowedOrigins: splitOrigins(origins) }
          : { kind, environment };
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
        <label className="check">
          <input
            type="radio"
            name="kind"
            value="publishable"
            checked={kind === "publishable"}
            onChange={() => setKind("publishable")}
          />
          <span className="check-text">
            <span className="check-title">
              Publishable key{" "}
              <span className="emoji" aria-hidden="true">
                🌐
              </span>
            </span>
            <span className="hint">
              For browsers and extensions. Send it as <code className="code-inline">?key=</code>. It works
              only from the allowed origins.
            </span>
          </span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="kind"
            value="secret"
            checked={kind === "secret"}
            onChange={() => setKind("secret")}
          />
          <span className="check-text">
            <span className="check-title">
              Secret key{" "}
              <span className="emoji" aria-hidden="true">
                🔒
              </span>
            </span>
            <span className="hint">
              For servers only: bots, MCP, back ends. Send it as{" "}
              <code className="code-inline">Authorization: Bearer</code>. Never put it in a browser.
            </span>
          </span>
        </label>
      </fieldset>

      {kind === "publishable" && (
        <OriginsField
          value={origins}
          onChange={setOrigins}
          environment={environment}
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
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
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
        <span className="emoji" aria-hidden="true">
          👀
        </span>
        <span>
          <strong>Shown once.</strong> This is the only time you can see the full key. We keep only a hash, so
          we cannot show it again. If you lose it, revoke it and create a new one.
        </span>
      </p>
      <div className="field">
        <label htmlFor={inputId} className="label">
          Your new {secret ? "secret" : "publishable"} key
        </label>
        <div className="copy-field">
          <input
            ref={inputRef}
            id={inputId}
            readOnly
            value={created.fullKey}
            spellCheck={false}
            aria-describedby={warningId}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className="btn btn-sm" onClick={copyKey}>
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
            Send it from your server as{" "}
            <code className="code-inline">Authorization: Bearer {created.key.prefix}…</code>
          </>
        ) : (
          <>
            Send it as <code className="code-inline">?key={created.key.prefix}…</code> from an allowed origin.
            Until you reload, the Overview’s live search and quick start use it.
          </>
        )}
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onDone}>
          I have saved the key
        </button>
      </div>
    </>
  );
}
