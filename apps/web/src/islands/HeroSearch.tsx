import { createSearchSession, type SearchResult, type SessionState } from "emojisense";
import { Fragment, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { fullEngine, sharedSemantic, useEngine } from "../lib/engine-client";
import "./hero-search.css";

/** Each example shows off one thing the engine understands. `lang` marks the non-English ones. */
const EXAMPLES: { query: string; kind: string; lang?: string }[] = [
  { query: "jurassic park", kind: "a film" },
  { query: "greatest of all time", kind: "a meaning" },
  { query: "hallowelen", kind: "a typo" },
  { query: "feliz cumpleaños", kind: "Spanish", lang: "es" },
  { query: "i'm exhausted", kind: "a feeling" },
  { query: "生日快乐", kind: "Chinese", lang: "zh" },
  { query: "congrats on the launch", kind: "an intent" },
  { query: "kolay gelsin", kind: "Turkish", lang: "tr" },
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
  // English answers the first keystroke; the other languages wait for interest or an idle page.
  const { engine, ready } = useEngine({ upgrade: "idle" });
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [example, setExample] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const exampleRef = useRef(0);
  const id = useId();
  const multilingual = ready === "all";

  const session = useMemo(() => {
    if (!engine) return undefined;
    const semantic = sharedSemantic();
    return createSearchSession({
      engine,
      ...(semantic ? { semantic } : {}),
      limit: LIMIT,
      debounceMs: 160,
      onChange: setState,
    });
  }, [engine]);

  useEffect(() => {
    session?.update(query);
    setActive(0);
  }, [session, query]);
  useEffect(() => () => session?.dispose(), [session]);

  // Types the examples until the visitor takes over. Under reduced motion it shows the first one.
  // Examples in other languages join once those packs are loaded, so none shows an English guess.
  useEffect(() => {
    if (!auto || paused || !engine) return;
    if (reducedMotion()) {
      setQuery(EXAMPLES[0]?.query ?? "");
      return;
    }
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        const i = exampleRef.current;
        const current = EXAMPLES[i];
        if (!current || (current.lang && !multilingual)) {
          exampleRef.current = (i + 1) % EXAMPLES.length;
          continue;
        }
        const chars = [...current.query];
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
        if (!cancelled) exampleRef.current = (i + 1) % EXAMPLES.length;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auto, paused, engine, multilingual]);

  const takeOver = (next?: string) => {
    fullEngine().catch(() => {});
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
  const loading = !engine && ready !== "failed";

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
          aria-autocomplete="list"
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
        <span className="hs-timing">
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

      <div className="hs-results">
        <div
          className="hs-list"
          id={`${id}-list`}
          role="listbox"
          aria-label="Emoji results"
          aria-busy={loading || undefined}
        >
          {loading &&
            Array.from({ length: LIMIT }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders that never reorder.
              <span key={i} className="hs-tile hs-skeleton" aria-hidden="true" />
            ))}
          {/* Tiles keep their place and only their emoji is replaced, so new results never shift the layout. */}
          {results.map((r, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: one tile per slot; the emoji inside is keyed by id.
              key={i}
              id={`${id}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              aria-label={label(r)}
              tabIndex={-1}
              className="hs-tile"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => {
                setActive(i);
                takeOver(query);
              }}
            >
              <span key={r.id} className="emoji" style={{ animationDelay: `${i * 22}ms` }}>
                {r.emoji}
              </span>
            </button>
          ))}
        </div>
        {engine && query.trim() && results.length === 0 && (
          <p className="hs-empty">No match yet — keep typing.</p>
        )}
      </div>

      {/* Announced only while the visitor drives: the autoplay would otherwise talk every second. */}
      <p className="hs-why" aria-live={auto ? "off" : "polite"}>
        {current ? (
          // A new key per answer replaces the line instead of moving its parts (no layout shift).
          <Fragment key={`${current.id}|${current.source}|${matched}|${auto && example}`}>
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
          </Fragment>
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
            lang={e.lang}
            aria-pressed={!auto && query === e.query}
            data-playing={auto && i === example ? "" : undefined}
            onClick={() => takeOver(e.query)}
          >
            {e.query}
          </button>
        ))}
        {auto && (
          // WCAG 2.2.2: moving content that starts on its own needs a way to stop it.
          <button type="button" className="hs-pause" onClick={() => setPaused((p) => !p)}>
            {paused ? "Play demo" : "Pause demo"}
          </button>
        )}
      </div>
    </div>
  );
}
