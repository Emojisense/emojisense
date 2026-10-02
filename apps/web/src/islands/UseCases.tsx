import { type ComponentType, type KeyboardEvent, lazy, Suspense, useId, useRef, useState } from "react";
import { AutoplayStop } from "../demos/autoplay-control";
import { DemoI18nProvider, type DemoMessages } from "../i18n/demos";
import { horizontalStep, useTranslator } from "../i18n/react";
import "./use-cases.css";

interface UseCase {
  /** Also the key of its label, title and body in the catalog (demos.useCases.cases). */
  id: "chat" | "docs" | "workspaces" | "photos" | "assistant";
  emoji: string;
  file: string;
}

const CASES: UseCase[] = [
  {
    id: "chat",
    emoji: "💬",
    file: "../demos/ChatDemo.tsx",
  },
  {
    id: "docs",
    emoji: "📝",
    file: "../demos/DocDemo.tsx",
  },
  {
    id: "workspaces",
    emoji: "🏢",
    file: "../demos/WorkspacesDemo.tsx",
  },
  {
    id: "photos",
    emoji: "📷",
    file: "../demos/PhotoDemo.tsx",
  },
  {
    id: "assistant",
    emoji: "🤖",
    file: "../demos/AssistantDemo.tsx",
  },
];

// Only reviewed demos are listed, so a demo that is still being written cannot break the page.
const modules = import.meta.glob<{ default: ComponentType }>([
  "../demos/ChatDemo.tsx",
  "../demos/DocDemo.tsx",
  "../demos/WorkspacesDemo.tsx",
  "../demos/PhotoDemo.tsx",
  "../demos/AssistantDemo.tsx",
]);
const demos = new Map(
  CASES.flatMap((c) => {
    const load = modules[c.file];
    return load ? [[c.id, lazy(load)] as const] : [];
  }),
);

/** Tabs of live mini apps. Each demo loads only when its tab is first opened. */
export interface UseCasesProps {
  /** The catalog's `demos` part, in the page's language. */
  messages: DemoMessages;
  /** Intl tag of the page. */
  lang: string;
}

export function UseCases({ messages, lang }: UseCasesProps) {
  const t = useTranslator(messages, lang);
  const [current, setCurrent] = useState<string>(CASES[0]?.id ?? "");
  const [opened, setOpened] = useState(() => new Set([current]));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  const open = (next: string) => {
    setCurrent(next);
    setOpened((s) => (s.has(next) ? s : new Set([...s, next])));
  };

  // WAI-ARIA tabs: arrows move between tabs, Home and End jump to the first and last.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = CASES.findIndex((c) => c.id === current);
    const step = horizontalStep(event);
    const target: Record<string, number> = {
      Home: 0,
      End: CASES.length - 1,
    };
    const nextIndex = step === 0 ? target[event.key] : (index + step + CASES.length) % CASES.length;
    const next = nextIndex === undefined ? undefined : CASES[nextIndex];
    if (nextIndex === undefined || !next) return;
    event.preventDefault();
    open(next.id);
    tabs.current[nextIndex]?.focus();
  };

  return (
    <DemoI18nProvider messages={messages} lang={lang}>
      <div className="uc">
        <div className="uc-tabs" role="tablist" aria-label={t.t("useCases.tabs")} onKeyDown={onKeyDown}>
          {CASES.map((c, i) => (
            <button
              key={c.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`${id}-tab-${c.id}`}
              type="button"
              role="tab"
              aria-selected={c.id === current}
              aria-controls={`${id}-panel-${c.id}`}
              tabIndex={c.id === current ? 0 : -1}
              className="uc-tab"
              onClick={() => open(c.id)}
            >
              <span className="emoji" aria-hidden="true">
                {c.emoji}
              </span>
              {t.t(`useCases.cases.${c.id}.label`)}
            </button>
          ))}
        </div>

        {CASES.map((c, i) => {
          const Demo = demos.get(c.id);
          return (
            <section
              key={c.id}
              id={`${id}-panel-${c.id}`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${c.id}`}
              hidden={c.id !== current}
              className="uc-panel"
              data-case={c.id}
            >
              <header className="uc-head">
                <h3>{t.t(`useCases.cases.${c.id}.title`)}</h3>
                <p>{t.t(`useCases.cases.${c.id}.body`)}</p>
              </header>
              {/* The stop button comes first in the DOM, before the moving demo; CSS puts it below. */}
              <AutoplayStop label={t.t("useCases.stop")} onStop={() => tabs.current[i]?.focus()}>
                <div className="uc-stage">
                  {!Demo ? (
                    <p className="uc-missing">{t.t("useCases.missing")}</p>
                  ) : opened.has(c.id) ? (
                    <Suspense
                      fallback={
                        <div className="uc-loading" role="status">
                          <span className="visually-hidden">
                            {t.t("useCases.loading", { name: t.t(`useCases.cases.${c.id}.label`) })}
                          </span>
                        </div>
                      }
                    >
                      <Demo />
                    </Suspense>
                  ) : null}
                </div>
              </AutoplayStop>
            </section>
          );
        })}
      </div>
    </DemoI18nProvider>
  );
}
