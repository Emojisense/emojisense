import { type KeyboardEvent, useId, useRef, useState } from "react";
import type { Messages } from "../i18n/catalogs";
import { horizontalStep, useTranslator } from "../i18n/react";

export interface CodeSample {
  id: string;
  label: string;
  code: string;
}

/** Install snippets as tabs, with a copy button. */
export interface CodeTabsProps {
  samples: CodeSample[];
  messages: Messages["codeTabs"];
  /** Intl tag of the page. */
  lang: string;
}

export function CodeTabs({ samples, messages, lang }: CodeTabsProps) {
  const t = useTranslator(messages, lang);
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
    const step = horizontalStep(event);
    const target: Record<string, number> = { Home: 0, End: samples.length - 1 };
    const nextIndex = step === 0 ? target[event.key] : (index + step + samples.length) % samples.length;
    const next = nextIndex === undefined ? undefined : samples[nextIndex];
    if (nextIndex === undefined || !next) return;
    event.preventDefault();
    setActive(next.id);
    tabs.current[nextIndex]?.focus();
  };

  return (
    <div className="code-tabs">
      <div className="code-bar">
        <div className="code-tablist" role="tablist" aria-label={t.t("label")} onKeyDown={onKeyDown}>
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
          {copied ? t.t("copied") : t.t("copy")}
          <span className="visually-hidden"> {t.t("example", { label: current?.label ?? "" })}</span>
        </button>
        <span className="visually-hidden" role="status">
          {copied ? t.t("copiedStatus") : ""}
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
