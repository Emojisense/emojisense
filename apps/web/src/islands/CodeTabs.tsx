import { useState } from "react";

export interface CodeSample {
  id: string;
  label: string;
  code: string;
}

/** Install snippets as tabs, with a copy button. */
export function CodeTabs({ samples }: { samples: CodeSample[] }) {
  const [active, setActive] = useState(samples[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
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

  return (
    <div className="code-tabs">
      <div className="code-tablist" role="tablist" aria-label="Install examples">
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={s.id === active}
            aria-controls={`panel-${s.id}`}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </button>
        ))}
        <button type="button" className="code-copy" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {current && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable tab panel must be reachable by keyboard (WAI-ARIA tabs pattern).
        <pre id={`panel-${current.id}`} role="tabpanel" aria-labelledby={`tab-${current.id}`} tabIndex={0}>
          <code>{current.code}</code>
        </pre>
      )}
    </div>
  );
}
