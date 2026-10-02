import { useId, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  value: string;
  /** Accessible name, e.g. "Copy the invite link". */
  label: string;
  /** Toast text after a copy. */
  done?: string;
  className?: string;
  showText?: boolean;
}

export function CopyButton({
  value,
  label,
  done = "Copied to the clipboard",
  className,
  showText,
}: CopyButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await writeClipboard(value)) {
      setCopied(true);
      toast(done);
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast("Copy did not work. Select the text and press ⌘C or Ctrl+C.");
    }
  }

  return (
    <button
      type="button"
      className={className ?? `btn btn-sm ${showText ? "" : "btn-icon"}`}
      aria-label={showText ? undefined : label}
      title={label}
      onClick={copy}
    >
      <Icon name={copied ? "check" : "copy"} />
      {showText && (copied ? "Copied" : "Copy")}
    </button>
  );
}

interface CopyFieldProps {
  value: string;
  label: string;
  /** Visible label above the field. */
  visibleLabel?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}

/** A read-only value that selects itself on focus, with a copy button. */
export function CopyField({ value, label, visibleLabel = false, describedBy, autoFocus }: CopyFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <label htmlFor={id} className={visibleLabel ? "label" : "visually-hidden"}>
        {label}
      </label>
      <div className="copy-field">
        <input
          ref={inputRef}
          id={id}
          readOnly
          value={value}
          spellCheck={false}
          aria-describedby={describedBy}
          // biome-ignore lint/a11y/noAutofocus: the value is what the dialog is for
          autoFocus={autoFocus}
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} showText className="btn btn-sm" />
      </div>
    </div>
  );
}
