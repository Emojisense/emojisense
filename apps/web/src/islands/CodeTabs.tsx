import { type KeyboardEvent, useId, useRef, useState } from "react";

export interface CodeSample {
  id: string;
  label: string;
  code: string;
}

/** Install snippets as tabs, with a copy button. */
export function CodeTabs({ samples }: { samples: CodeSample[] }) {
  const [active, setActive] = useState(samples[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const current = samples.find((s) => s.id === active) ?? samples[0];

  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  // WAI-ARIA tabs: one tab stop; arrows, Home and End move between tabs.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = samples.findIndex((s) => s.id === active);
    const target: Record<string, number> = {
      ArrowRight: (index + 1) % samples.length,
      ArrowLeft: (index - 1 + samples.length) % samples.length,
      Home: 0,
      End: samples.length - 1,
    };
    const nextIndex = target[event.key];
    const next = nextIndex === undefined ? undefined : samples[nextIndex];
    if (nextIndex === undefined || !next) return;
    event.preventDefault();
    setActive(next.id);
    tabs.current[nextIndex]?.focus();
  };

  return (
    <div className="code-tabs">
      <div className="code-bar">
        <div className="code-tablist" role="tablist" aria-label="Install examples" onKeyDown={onKeyDown}>
          {samples.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${s.id}`}
              aria-selected={s.id === active}
              aria-controls={s.id === active ? `${id}-panel-${s.id}` : undefined}
              tabIndex={s.id === active ? 0 : -1}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="code-copy" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
          <span className="visually-hidden"> {current?.label} example</span>
        </button>
        <span className="visually-hidden" role="status">
          {copied ? "Copied" : ""}
        </span>
      </div>
      {current && (
        <pre
          id={`${id}-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${current.id}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable tab panel must be reachable by keyboard (WAI-ARIA tabs pattern).
          tabIndex={0}
        >
          <code>{current.code}</code>
        </pre>
      )}
    </div>
  );
}
