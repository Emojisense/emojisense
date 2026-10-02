import {
  type AliasEngine,
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  loadPacks,
  type SearchResult,
  type SessionState,
} from "emojisense";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import "./hero-demo.css";

export interface HeroDemoProps {
  apiUrl: string;
  packBaseUrl: string;
  publishableKey: string;
}

interface Example {
  query: string;
  /** What it shows off, in a few words. */
  note: string;
}

const EXAMPLES: Example[] = [
  { query: "jurassic park", note: "films" },
  { query: "congrats on the launch", note: "intent" },
  { query: "greatest of all time", note: "meaning" },
  { query: "hallowelen", note: "typos" },
  { query: "feliz cumple", note: "Spanish" },
  { query: "生日快乐", note: "Chinese" },
  { query: "i'm exhausted", note: "feelings" },
  { query: "kolay gelsin", note: "Turkish" },
];
/** Loaded after the first paint, so English answers instantly. */
const EXTRA_LOCALES = ["es", "zh", "tr", "hi", "pt", "fr"];
const LIMIT = 8;
const TYPE_MS = 70;
const ERASE_MS = 28;
const HOLD_MS = 1900;

type Phase = { kind: "typing" | "holding" | "erasing"; example: number; length: number };

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A chat app whose emoji picker runs the real engine, packs and API. It types by itself until you take over. */
export function HeroDemo({ apiUrl, packBaseUrl, publishableKey }: HeroDemoProps) {
  const [engine, setEngine] = useState<AliasEngine | undefined>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [note, setNote] = useState(EXAMPLES[0]?.note ?? "");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // English first (fast), then more languages once the page is idle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const core = await loadPacks({ baseUrl: packBaseUrl, locales: ["en"] });
        if (cancelled) return;
        setEngine(createEngine(core));
        await wait(1200);
        // Each language on its own: a missing pack must not take the others down.
        const settled = await Promise.allSettled(
          ["en", ...EXTRA_LOCALES].flatMap((locale) =>
            (["core", "ext"] as const).map((part) =>
              loadPacks({ baseUrl: packBaseUrl, locales: [locale], part }),
            ),
          ),
        );
        const packs = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        // loadPacks always prepends English core; keep one copy of each file, cores first.
        const unique = new Map(packs.map((p) => [`${p.locale}:${p.part ?? "core"}`, p]));
        const ordered = [...unique.values()].sort(
          (a, b) => Number(a.part === "ext") - Number(b.part === "ext"),
        );
        if (!cancelled && ordered.length > 0) setEngine(createEngine(ordered));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packBaseUrl]);

  const semantic = useMemo(
    () => createLayeredSemantic({ endpoint: apiUrl, key: publishableKey }),
    [apiUrl, publishableKey],
  );
  const session = useMemo(
    () =>
      engine
        ? createSearchSession({
            engine,
            ...(semantic ? { semantic } : {}),
            limit: LIMIT,
            debounceMs: 180,
            onChange: setState,
          })
        : undefined,
    [engine, semantic],
  );

  useEffect(() => {
    session?.update(query);
    setActive(0);
  }, [session, query]);
  useEffect(() => () => session?.dispose(), [session]);

  // The typewriter. It stops for good as soon as the visitor touches the input.
  useEffect(() => {
    if (!auto || !engine) return;
    let cancelled = false;
    (async () => {
      let phase: Phase = { kind: "typing", example: 0, length: 0 };
      while (!cancelled) {
        const example = EXAMPLES[phase.example] as Example;
        const chars = [...example.query];
        setNote(example.note);
        if (phase.kind === "typing") {
          setQuery(chars.slice(0, phase.length).join(""));
          if (phase.length >= chars.length) phase = { ...phase, kind: "holding" };
          else phase = { ...phase, length: phase.length + 1 };
          await wait(TYPE_MS);
        } else if (phase.kind === "holding") {
          await wait(HOLD_MS);
          phase = { ...phase, kind: "erasing" };
        } else {
          setQuery(chars.slice(0, phase.length).join(""));
          if (phase.length === 0)
            phase = { kind: "typing", example: (phase.example + 1) % EXAMPLES.length, length: 0 };
          else phase = { ...phase, length: phase.length - 1 };
          await wait(ERASE_MS);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auto, engine]);

  const results: SearchResult[] = query.trim() ? (state?.results ?? []) : [];
  const top = results[0];
  const why = top && state?.alias.results.find((r) => r.id === top.id)?.match;
  const label = (r: SearchResult) => engine?.get(r.id)?.labels.en ?? r.emoji;

  const takeOver = () => {
    if (!auto) return;
    setAuto(false);
    setQuery("");
  };

  const pick = (r: SearchResult) => {
    setMessage((m) => `${m}${r.emoji}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
    const move = moves[event.key];
    if (move !== undefined && results.length > 0) {
      event.preventDefault();
      setActive((i) => Math.min(results.length - 1, Math.max(0, i + move)));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      pick(results[active] as SearchResult);
    }
  };

  return (
    <section className="demo" aria-label="Live demo: a chat app with an Emojisense picker">
      <div className="demo-bar" aria-hidden="true">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="channel"># launch-party</span>
      </div>

      <div className="demo-body">
        <ul className="messages" aria-hidden="true">
          <li>
            <span className="avatar emoji">🧑‍🚀</span>
            <div>
              <p className="name">Ada</p>
              <p className="text">We just shipped the new onboarding!</p>
            </div>
          </li>
          <li>
            <span className="avatar emoji">🦊</span>
            <div>
              <p className="name">Kai</p>
              <p className="text">huge. what's the emoji for this</p>
            </div>
          </li>
        </ul>

        <div className="picker">
          <div className="search">
            <span className="emoji search-icon" aria-hidden="true">
              🔍
            </span>
            <label className="visually-hidden" htmlFor={`${listboxId}-input`}>
              Search emoji
            </label>
            <input
              id={`${listboxId}-input`}
              ref={inputRef}
              value={query}
              onFocus={takeOver}
              onPointerDown={takeOver}
              onChange={(e) => {
                setAuto(false);
                setQuery(e.target.value);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search emoji…"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listboxId}
              aria-activedescendant={results.length > 0 ? `${listboxId}-${active}` : undefined}
            />
            {auto && <span className="caret" aria-hidden="true" />}
            {auto && query && <span className="note">{note}</span>}
          </div>

          <div className="results" id={listboxId} role="listbox" aria-label="Emoji results">
            {!engine &&
              !failed &&
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders that never reorder.
              Array.from({ length: LIMIT }, (_, i) => <span key={i} className="tile skeleton" />)}
            {failed && <p className="empty">The live demo cannot reach the search API right now.</p>}
            {engine && query.trim() && results.length === 0 && (
              <p className="empty">
                <span className="emoji">🫥</span> No match yet. Keep typing.
              </p>
            )}
            {results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === active}
                aria-label={label(r)}
                className={`tile${i === 0 ? " top" : ""}`}
                style={{ animationDelay: `${i * 18}ms` }}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                tabIndex={-1}
              >
                <span className="emoji">{r.emoji}</span>
              </button>
            ))}
          </div>

          <p className="why" aria-live="polite">
            {top ? (
              <>
                <span className="emoji why-emoji">{top.emoji}</span>
                {why ? (
                  <>
                    matched <q>{why}</q>
                  </>
                ) : (
                  <>matched by meaning</>
                )}
              </>
            ) : (
              <>Type anything: a feeling, a film, a typo.</>
            )}
          </p>
        </div>

        <div className="composer">
          <span className="composer-text">
            {message || <span className="placeholder">Message #launch-party</span>}
          </span>
          <span className="send emoji" aria-hidden="true">
            ➤
          </span>
        </div>
      </div>
    </section>
  );
}
