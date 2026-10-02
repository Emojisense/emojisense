import { type KeyboardEvent, useId, useMemo, useRef } from "react";
import { useCopy } from "./hooks";
import { tokenize } from "./lib/highlight";
import type { CodeSample } from "./lib/snippets";

interface CodePanelProps {
  title: string;
  samples: CodeSample[];
  selected: CodeSample["id"];
  onSelect: (id: CodeSample["id"]) => void;
}

/** "Copy as code": the same call as the playground's current settings, as SDK code and as curl. */
export function CodePanel({ title, samples, selected, onSelect }: CodePanelProps) {
  const current = samples.find((sample) => sample.id === selected) ?? samples[0];
  const { copied, copy } = useCopy();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const tokens = useMemo(() => (current ? tokenize(current.code, current.language) : []), [current]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step || !current) return;
    event.preventDefault();
    const index = samples.indexOf(current);
    const next = samples[(index + step + samples.length) % samples.length];
    if (!next) return;
    onSelect(next.id);
    tabs.current[samples.indexOf(next)]?.focus();
  };

  if (!current) return null;
  return (
    <section className="pg-code" aria-labelledby={`${id}-title`}>
      <header className="pg-code-head">
        <h2 id={`${id}-title`} className="pg-label">
          {title}
        </h2>
        <div className="pg-code-tabs" role="tablist" aria-label="Language" onKeyDown={onKeyDown}>
          {samples.map((sample, index) => (
            <button
              key={sample.id}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${sample.id}`}
              aria-selected={sample.id === current.id}
              aria-controls={`${id}-panel`}
              tabIndex={sample.id === current.id ? 0 : -1}
              onClick={() => onSelect(sample.id)}
            >
              {sample.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="pg-button pg-button-quiet"
          onClick={() => copy(current.code, current.code)}
        >
          {copied === current.code ? "Copied" : "Copy"}
        </button>
      </header>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable tab panel must be reachable by keyboard (WAI-ARIA tabs pattern). */}
      <pre id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current.id}`} tabIndex={0}>
        <code>
          {tokens.map((token, index) =>
            token.kind === "plain" ? (
              token.text
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one fixed string, never reordered.
              <span key={index} className={`pg-tok-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </section>
  );
}
