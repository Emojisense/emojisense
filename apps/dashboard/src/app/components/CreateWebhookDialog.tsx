import { type FormEvent, useId, useState } from "react";
import {
  ApiError,
  api,
  type CreatedWebhook,
  errorMessage,
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookEvent,
} from "../api";
import { CodeBlock } from "../ui/CodeBlock";
import { CopyField } from "../ui/Copy";
import { Dialog } from "../ui/Dialog";

export const EVENT_COPY: Record<WebhookEvent, string> = {
  "custom_emoji.created": "A custom emoji is added",
  "custom_emoji.deleted": "A custom emoji is deleted",
  "tenant.created": "A tenant is added",
  "tenant.deleted": "A tenant is deleted",
  "usage.threshold": "Usage passes 80% or 100% of a limit",
};

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// Header: Emojisense-Signature: t=<unix seconds>,v1=<hex>
export function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return fresh && timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
}`;

interface CreateWebhookDialogProps {
  appId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (webhook: Webhook) => void;
}

/** Two steps, like keys: the form, then the only view of the signing secret. */
export function CreateWebhookDialog({ appId, open, onClose, onCreated }: CreateWebhookDialogProps) {
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const close = () => {
    setCreated(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      title={created ? "Copy your signing secret" : "Add an endpoint"}
      description={created ? undefined : "We POST a signed JSON event to this URL when something happens."}
      onClose={close}
      dismissible={created === null}
      size="lg"
    >
      {created ? (
        <SecretReveal secret={created.secret} onDone={close} />
      ) : (
        <WebhookForm
          appId={appId}
          onCancel={close}
          onCreated={(result) => {
            setCreated(result);
            onCreated(result.webhook);
          }}
        />
      )}
    </Dialog>
  );
}

function WebhookForm({
  appId,
  onCancel,
  onCreated,
}: {
  appId: string;
  onCancel: () => void;
  onCreated: (result: CreatedWebhook) => void;
}) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const urlId = useId();

  function toggle(event: WebhookEvent) {
    setEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^https:\/\/\S+$/.test(url.trim())) {
      setError({ message: "Use an https:// URL your server answers on.", field: "url" });
      return;
    }
    if (events.length === 0) {
      setError({ message: "Choose at least one event.", field: "events" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createWebhook(appId, { url: url.trim(), events }));
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
      <div className="field">
        <label htmlFor={urlId} className="label">
          Endpoint URL
        </label>
        <input
          id={urlId}
          className="input input-mono"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://api.example.com/hooks/emojisense"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={error?.field === "url"}
        />
      </div>
      <fieldset className="choices">
        <legend>Events</legend>
        {WEBHOOK_EVENTS.map((name) => (
          <label key={name} className="check">
            <input type="checkbox" checked={events.includes(name)} onChange={() => toggle(name)} />
            <span className="check-text">
              <span className="check-title">{EVENT_COPY[name]}</span>
              <span className="hint mono">{name}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Adding…" : "Add endpoint"}
        </button>
      </div>
    </form>
  );
}

function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const warningId = useId();
  return (
    <>
      <p id={warningId} className="notice notice-warning">
        <span className="emoji" aria-hidden="true">
          👀
        </span>
        <span>
          <strong>Shown once.</strong> Store the secret with your server’s other secrets. It signs every
          delivery, so you can check that a request really came from Emojisense.
        </span>
      </p>
      <CopyField value={secret} label="Signing secret" visibleLabel describedBy={warningId} autoFocus />
      <CodeBlock code={VERIFY_SNIPPET} label="Signature check" />
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onDone}>
          I have saved the secret
        </button>
      </div>
    </>
  );
}
