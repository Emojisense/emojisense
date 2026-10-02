import { createSearchSession, type SearchResult, type SessionState } from "emojisense";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { sharedSemantic, useEngine } from "../lib/engine-client";
import "./hero-search.css";

/** Each example shows off one thing the engine understands. */
const EXAMPLES = [
  { query: "jurassic park", kind: "a film" },
  { query: "greatest of all time", kind: "a meaning" },
  { query: "hallowelen", kind: "a typo" },
  { query: "feliz cumpleaños", kind: "Spanish" },
  { query: "i'm exhausted", kind: "a feeling" },
  { query: "生日快乐", kind: "Chinese" },
  { query: "congrats on the launch", kind: "an intent" },
  { query: "kolay gelsin", kind: "Turkish" },
  { query: "break a leg", kind: "an idiom" },
];
const LIMIT = 9;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function formatMs(ms: number): string {
  if (ms < 0.1) return "< 0.1 ms";
  return ms < 1 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}

/** The hero: one big search box running the real engine in the visitor's browser. */
export function HeroSearch() {
  const { engine, ready } = useEngine();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [example, setExample] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const session = useMemo(() => {
    if (!engine) return undefined;
    const semantic = sharedSemantic();
    return createSearchSession({ engine, ...(semantic ? { semantic } : {}), limit: LIMIT, debounceMs: 160, onChange: setState });
  }, [engine]);

  useEffect(() => {
    session?.update(query);
    setActive(0);
  }, [session, query]);
  useEffect(() => () => session?.dispose(), [session]);

  // Types the examples until the visitor takes over. Under reduced motion it shows the first one.
  useEffect(() => {
    if (!auto || !engine) return;
    if (reducedMotion()) {
      setQuery(EXAMPLES[0]?.query ?? "");
      return;
    }
    let cancelled = false;
    (async () => {
      for (let i = 0; !cancelled; i = (i + 1) % EXAMPLES.length) {
        const chars = [...(EXAMPLES[i]?.query ?? "")];
        setExample(i);
        for (let n = 1; n <= chars.length && !cancelled; n++) {
          setQuery(chars.slice(0, n).join(""));
          await wait(55 + Math.random() * 70);
        }
        await wait(2200);
        for (let n = chars.length - 1; n >= 0 && !cancelled; n--) {
          setQuery(chars.slice(0, n).join(""));
          await wait(22);
        }
        await wait(260);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auto, engine]);

  const takeOver = (next?: string) => {
    if (auto) setAuto(false);
    if (next !== undefined) {
      setQuery(next);
      inputRef.current?.focus();
    } else if (auto) {
      setQuery("");
    }
  };

  const results: SearchResult[] = query.trim() ? (state?.results ?? []) : [];
  const current = results[active];
  const label = (r: SearchResult) => engine?.get(r.id)?.labels.en ?? r.emoji;
  const matched = current && state?.alias.results.find((r) => r.id === current.id)?.match;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    const move = step[event.key];
    if (move !== undefined && results.length > 0) {
      event.preventDefault();
      setActive((i) => (i + move + results.length) % results.length);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };

  const timing = (() => {
    if (!state || !query.trim()) return undefined;
    if (state.status === "fused" && state.semanticMs !== undefined) {
      return state.semanticCached ? "edge cache" : `${formatMs(state.semanticMs)} · edge AI`;
    }
    return `${formatMs(state.aliasMs)} · on your device`;
  })();

  return (
    <div className="hs">
      <div className="hs-bar">
        <svg className="hs-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <label className="visually-hidden" htmlFor={`${id}-q`}>
          Search emoji
        </label>
        <input
          id={`${id}-q`}
          ref={inputRef}
          value={query}
          placeholder="Search emoji the way people talk…"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={current ? `${id}-${active}` : undefined}
          onFocus={() => takeOver()}
          onPointerDown={() => takeOver()}
          onChange={(e) => {
            setAuto(false);
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="hs-timing" aria-live="off">
          {timing ? (
            <>
              <span className="hs-dot" aria-hidden="true" />
              {timing}
            </>
          ) : ready === "failed" ? (
            "offline"
          ) : null}
        </span>
      </div>

      <div className="hs-results" id={`${id}-list`} role="listbox" aria-label="Emoji results">
        {!engine &&
          ready !== "failed" &&
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders that never reorder.
          Array.from({ length: LIMIT }, (_, i) => <span key={i} className="hs-tile hs-skeleton" />)}
        {results.map((r, i) => (
          <button
            key={r.id}
            id={`${id}-${i}`}
            type="button"
            role="option"
            aria-selected={i === active}
            aria-label={label(r)}
            tabIndex={-1}
            className="hs-tile"
            style={{ animationDelay: `${i * 22}ms` }}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => {
              setActive(i);
              takeOver(query);
            }}
          >
            <span className="emoji">{r.emoji}</span>
          </button>
        ))}
        {engine && query.trim() && results.length === 0 && <p className="hs-empty">No match yet — keep typing.</p>}
      </div>

      <p className="hs-why" aria-live="polite">
        {current ? (
          <>
            <span className="hs-name">{label(current)}</span>
            <span className="hs-sep" aria-hidden="true">
              ·
            </span>
            {current.source === "semantic" ? (
              "matched by meaning"
            ) : matched ? (
              <>
                matched <q>{matched}</q>
              </>
            ) : (
              "best match"
            )}
            {auto && <span className="hs-kind">{EXAMPLES[example]?.kind}</span>}
          </>
        ) : (
          <>A film, a feeling, a typo, another language — try anything.</>
        )}
      </p>

      <div className="hs-try">
        <span className="hs-try-label">Try</span>
        {EXAMPLES.map((e, i) => (
          <button
            key={e.query}
            type="button"
            className="hs-chip"
            aria-pressed={!auto && query === e.query}
            data-playing={auto && i === example ? "" : undefined}
            onClick={() => takeOver(e.query)}
          >
            {e.query}
          </button>
        ))}
      </div>
    </div>
  );
}
