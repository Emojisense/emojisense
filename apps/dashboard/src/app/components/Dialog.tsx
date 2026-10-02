import { type ReactNode, useEffect, useId, useRef } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `false` ignores Escape, for a step whose content is lost for good when it closes. */
  dismissible?: boolean;
}

/**
 * Native modal <dialog>: the browser traps focus, makes the page inert and returns focus to
 * the opener on close. Content mounts only while open, so each opening starts fresh.
 */
export function Dialog({ open, title, onClose, children, dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <div className="dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
