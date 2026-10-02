import { type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";

interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** `false` ignores Escape and hides the close button, for a step whose content is lost for good when it closes. */
  dismissible?: boolean;
  size?: "md" | "lg";
}

/**
 * Native modal <dialog>: the browser traps focus, makes the page inert and returns focus to
 * the opener on close. Content mounts only while open, so each opening starts fresh.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  dismissible = true,
  size = "md",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
    >
      {open && (
        <>
          <div className="dialog-head">
            <div>
              <h2 id={titleId} className="dialog-title">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="dialog-desc">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label="Close"
                onClick={onClose}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
          <div className="dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
