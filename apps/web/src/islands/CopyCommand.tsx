import { useEffect, useRef, useState } from "react";
import "./copy-command.css";

type CopyState = "idle" | "copied" | "selected";

const RESET_MS = 1600;

const ANNOUNCEMENTS: Record<CopyState, string> = {
  idle: "",
  copied: "Copied",
  selected: "Command selected. Copy it with your keyboard.",
};

export interface CopyCommandProps {
  command: string;
  /** Shown before the command, e.g. "$". Pass "" for a snippet that is not a shell command. */
  prompt?: string | undefined;
}

/** A command chip: one click copies it and shows "Copied". */
export function CopyCommand({ command, prompt = "$" }: CopyCommandProps) {
  const [state, setState] = useState<CopyState>("idle");
  const textRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // No clipboard access (old browser or permission denied): select the text for a manual copy.
      if (textRef.current) window.getSelection()?.selectAllChildren(textRef.current);
      next = "selected";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
  };

  return (
    <>
      <button
        type="button"
        className="copycmd"
        data-state={state}
        aria-label={`Copy command: ${command}`}
        onClick={copy}
      >
        {prompt && (
          <span className="copycmd-prompt" aria-hidden="true">
            {prompt}
          </span>
        )}
        {/* tabIndex -1: the scroller must not become a second tab stop inside the button. */}
        <code className="copycmd-text" ref={textRef} tabIndex={-1}>
          {command}
        </code>
        <svg className="copycmd-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="2" />
          <path d="M10.75 5.25V4.25a2 2 0 0 0-2-2h-4.5a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2h1" />
        </svg>
        <span className="copycmd-done" aria-hidden="true">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          {state === "selected" ? "Selected" : "Copied"}
        </span>
      </button>
      <span className="visually-hidden" role="status">
        {ANNOUNCEMENTS[state]}
      </span>
    </>
  );
}
