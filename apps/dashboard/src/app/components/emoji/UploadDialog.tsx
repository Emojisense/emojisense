import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { ApiError, api, type CustomEmoji, errorMessage, isPlanRequired, type Tenant } from "../../api";
import { fileProblem, formatBytes, parseAliases, shortcodeProblem, toShortcode } from "../../lib/emoji";
import { Dialog } from "../../ui/Dialog";
import { PlanGate } from "../../ui/PlanGate";
import { DropZone } from "./DropZone";

export interface UploadRequest {
  files: File[];
  shortcode?: string;
  aliases?: string;
}

interface UploadDialogProps {
  appId: string;
  request: UploadRequest | null;
  tenants: Tenant[];
  onUploaded: (emoji: CustomEmoji) => void;
  onClose: () => void;
}

export function UploadDialog({ appId, request, tenants, onUploaded, onClose }: UploadDialogProps) {
  return (
    <Dialog
      open={request !== null}
      title="Upload a custom emoji"
      description="People find it by its shortcode and aliases, next to the standard emoji."
      onClose={onClose}
    >
      {request && (
        <UploadForm
          appId={appId}
          request={request}
          tenants={tenants}
          onUploaded={onUploaded}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function UploadForm({
  appId,
  request,
  tenants,
  onUploaded,
  onClose,
}: UploadDialogProps & { request: UploadRequest }) {
  const [queue, setQueue] = useState<File[]>(request.files);
  const file = queue[0] ?? null;
  const [shortcode, setShortcode] = useState(request.shortcode ?? (file ? toShortcode(file.name) : ""));
  const [aliases, setAliases] = useState(request.aliases ?? "");
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [planRequired, setPlanRequired] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const shortcodeId = useId();
  const aliasesId = useId();
  const tenantSelectId = useId();
  const errorId = useId();
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function chooseFiles(files: File[]) {
    setQueue(files);
    setError(null);
    const first = files[0];
    if (first && !request.shortcode) setShortcode(toShortcode(first.name));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError({ message: "Choose an image first.", field: "file" });
      return;
    }
    const problem = fileProblem(file);
    if (problem) {
      setError({ message: problem, field: "file" });
      return;
    }
    const codeProblem = shortcodeProblem(shortcode);
    if (codeProblem) {
      setError({ message: codeProblem, field: "shortcode" });
      return;
    }
    setBusy(true);
    try {
      const emoji = await api.uploadEmoji(appId, {
        file,
        shortcode,
        aliases: parseAliases(aliases),
        ...(tenantId ? { tenantId } : {}),
      });
      onUploaded(emoji);
      const rest = queue.slice(1);
      if (rest.length === 0) {
        onClose();
        return;
      }
      setQueue(rest);
      setShortcode(toShortcode(rest[0]?.name ?? ""));
      setAliases("");
    } catch (caught) {
      if (isPlanRequired(caught)) setPlanRequired(caught);
      else
        setError({
          message: errorMessage(caught),
          field: caught instanceof ApiError ? caught.field : undefined,
        });
    } finally {
      setBusy(false);
    }
  }

  if (planRequired && isPlanRequired(planRequired)) {
    return <PlanGate feature="custom_emoji" plan={planRequired.plan} compact />;
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="upload-file">
        {file && preview ? (
          <div className="upload-preview">
            <span className="upload-preview-tile">
              <img src={preview} alt="" />
            </span>
            <span className="upload-preview-tile upload-preview-tile-small">
              <img src={preview} alt="" />
            </span>
            <div className="upload-preview-text">
              <span className="upload-file-name">{file.name}</span>
              <span className="hint">
                {formatBytes(file.size)}
                {queue.length > 1 && ` · ${queue.length - 1} more after this one`}
              </span>
              <DropZone onFiles={chooseFiles} compact>
                <span className="link">Choose another image</span>
              </DropZone>
            </div>
          </div>
        ) : (
          <DropZone onFiles={chooseFiles} />
        )}
      </div>

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
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="ship_it"
            onChange={(event) => setShortcode(event.target.value.toLowerCase())}
            aria-invalid={error?.field === "shortcode"}
            aria-describedby={error?.field === "shortcode" ? errorId : undefined}
          />
          <span aria-hidden="true">:</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor={aliasesId} className="label">
          Aliases <span className="label-optional">optional</span>
        </label>
        <input
          id={aliasesId}
          className="input"
          value={aliases}
          autoComplete="off"
          placeholder="ship it, launch, lgtm"
          onChange={(event) => setAliases(event.target.value)}
          aria-invalid={error?.field === "aliases"}
        />
        <p className="hint">Comma separated. Words people type when they want this emoji.</p>
      </div>

      {tenants.length > 0 && (
        <div className="field">
          <label htmlFor={tenantSelectId} className="label">
            Visible to
          </label>
          <select
            id={tenantSelectId}
            className="input"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
          >
            <option value="">Everyone (app-wide)</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name ?? tenant.externalId} only
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p id={errorId} className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Uploading…" : queue.length > 1 ? "Upload and next" : "Upload emoji"}
        </button>
      </div>
    </form>
  );
}
