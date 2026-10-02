import { type FormEvent, useId, useState } from "react";
import { ApiError, api, type CustomEmoji, errorMessage, type Tenant } from "../../api";
import { formatDate } from "../../format";
import { formatBytes, parseAliases, shortcodeProblem } from "../../lib/emoji";
import { Dialog } from "../../ui/Dialog";
import { Icon } from "../../ui/Icon";

const SOURCE_LABEL: Record<CustomEmoji["source"], string> = {
  upload: "Uploaded",
  slack: "Imported from Slack",
  discord: "Imported from Discord",
  api: "Added with the API",
};

interface EditEmojiDialogProps {
  appId: string;
  emoji: CustomEmoji | null;
  tenants: Tenant[];
  readOnly: boolean;
  onSaved: (emoji: CustomEmoji) => void;
  onDeleted: (emoji: CustomEmoji) => void;
  onClose: () => void;
}

export function EditEmojiDialog({ emoji, onClose, ...rest }: EditEmojiDialogProps) {
  return (
    <Dialog open={emoji !== null} title={emoji ? `:${emoji.shortcode}:` : "Custom emoji"} onClose={onClose}>
      {emoji && <EditForm key={emoji.id} emoji={emoji} onClose={onClose} {...rest} />}
    </Dialog>
  );
}

function EditForm({
  appId,
  emoji,
  tenants,
  readOnly,
  onSaved,
  onDeleted,
  onClose,
}: EditEmojiDialogProps & { emoji: CustomEmoji }) {
  const [shortcode, setShortcode] = useState(emoji.shortcode);
  const [aliases, setAliases] = useState(emoji.aliases.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const shortcodeId = useId();
  const aliasesId = useId();
  const tenant = emoji.tenantId ? tenants.find((item) => item.id === emoji.tenantId) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = shortcodeProblem(shortcode);
    if (problem) {
      setError({ message: problem, field: "shortcode" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.updateEmoji(appId, emoji.id, { shortcode, aliases: parseAliases(aliases) }));
    } catch (caught) {
      setError({
        message: errorMessage(caught),
        field: caught instanceof ApiError ? caught.field : undefined,
      });
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteEmoji(appId, emoji.id);
      onDeleted(emoji);
    } catch (caught) {
      setError({ message: errorMessage(caught) });
      setBusy(false);
    }
  }

  const details = (
    <div className="emoji-detail">
      <span className="emoji-detail-tile">
        <img src={emoji.imageUrl} alt={`:${emoji.shortcode}:`} />
      </span>
      <dl className="emoji-detail-facts">
        <div>
          <dt>Source</dt>
          <dd>{SOURCE_LABEL[emoji.source]}</dd>
        </div>
        <div>
          <dt>Visible to</dt>
          <dd>{tenant ? (tenant.name ?? tenant.externalId) : emoji.tenantId ? "One tenant" : "Everyone"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(emoji.bytes)}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{formatDate(emoji.createdAt)}</dd>
        </div>
      </dl>
    </div>
  );

  if (confirming) {
    return (
      <>
        {details}
        <p>
          Delete <code className="code-inline">:{emoji.shortcode}:</code>? Search stops finding it right away.
          Messages that already use it show the shortcode as text.
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error.message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep it
          </button>
          <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={remove}>
            {busy ? "Deleting…" : "Delete emoji"}
          </button>
        </div>
      </>
    );
  }

  return (
    <form className="form" onSubmit={save} noValidate>
      {details}
      <div className="field">
        <label htmlFor={shortcodeId} className="label">
          Shortcode
        </label>
        <div className="shortcode-input">
          <span aria-hidden="true">:</span>
          <input
            id={shortcodeId}
            className="input input-mono"
            value={shortcode}
            readOnly={readOnly}
            maxLength={64}
            spellCheck={false}
            onChange={(event) => setShortcode(event.target.value.toLowerCase())}
            aria-invalid={error?.field === "shortcode"}
          />
          <span aria-hidden="true">:</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor={aliasesId} className="label">
          Aliases
        </label>
        <input
          id={aliasesId}
          className="input"
          value={aliases}
          readOnly={readOnly}
          placeholder="ship it, launch"
          onChange={(event) => setAliases(event.target.value)}
        />
        <p className="hint">Comma separated. Words people type when they want this emoji.</p>
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}
      {!readOnly && (
        <div className="dialog-actions dialog-actions-split">
          <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirming(true)}>
            <Icon name="trash" />
            Delete
          </button>
          <span className="btn-row">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      )}
    </form>
  );
}
