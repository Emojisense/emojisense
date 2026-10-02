import { type ComponentType, type KeyboardEvent, lazy, Suspense, useId, useRef, useState } from "react";
import { AutoplayStop } from "../demos/autoplay-control";
import "./use-cases.css";

interface UseCase {
  id: string;
  emoji: string;
  label: string;
  title: string;
  body: string;
  file: string;
}

const CASES: UseCase[] = [
  {
    id: "chat",
    emoji: "💬",
    label: "Chat",
    title: "Type a colon, find the feeling",
    body: "Autocomplete that understands slang and meaning, plus reaction suggestions for every message.",
    file: "../demos/ChatDemo.tsx",
  },
  {
    id: "docs",
    emoji: "📝",
    label: "Docs",
    title: "Emoji inline, while you write",
    body: "A drop-in Tiptap extension. The same engine works in Lexical and any editor.",
    file: "../demos/DocDemo.tsx",
  },
  {
    id: "workspaces",
    emoji: "🏢",
    label: "Workspaces",
    title: "Every customer, their own emoji",
    body: "Custom emoji are searched next to the standard set, with one set per workspace.",
    file: "../demos/WorkspacesDemo.tsx",
  },
  {
    id: "photos",
    emoji: "📷",
    label: "Photos",
    title: "Reactions for a photo",
    body: "Send a picture, get the emoji people would react with. Photos are never stored.",
    file: "../demos/PhotoDemo.tsx",
  },
  {
    id: "assistant",
    emoji: "🤖",
    label: "AI assistant",
    title: "Give your AI good taste in emoji",
    body: "An MCP server lets any assistant search emoji by meaning, in 11 languages.",
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
export function UseCases() {
  const [current, setCurrent] = useState(CASES[0]?.id ?? "");
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
    const target: Record<string, number> = {
      ArrowRight: (index + 1) % CASES.length,
      ArrowLeft: (index - 1 + CASES.length) % CASES.length,
      Home: 0,
      End: CASES.length - 1,
    };
    const nextIndex = target[event.key];
    const next = nextIndex === undefined ? undefined : CASES[nextIndex];
    if (nextIndex === undefined || !next) return;
    event.preventDefault();
    open(next.id);
    tabs.current[nextIndex]?.focus();
  };

  return (
    <div className="uc">
      <div className="uc-tabs" role="tablist" aria-label="Use cases" onKeyDown={onKeyDown}>
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
            {c.label}
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
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </header>
            {/* The stop button comes first in the DOM, before the moving demo; CSS puts it below. */}
            <AutoplayStop onStop={() => tabs.current[i]?.focus()}>
              <div className="uc-stage">
                {!Demo ? (
                  <p className="uc-missing">This demo is not built yet.</p>
                ) : opened.has(c.id) ? (
                  <Suspense
                    fallback={
                      <div className="uc-loading" role="status">
                        <span className="visually-hidden">Loading the {c.label} demo…</span>
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
  );
}
