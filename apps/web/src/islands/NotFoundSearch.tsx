import type { AliasResult } from "emojisense";
import { useEffect, useId, useMemo, useState } from "react";
import { fullEngine, pageLocale, searchLocales, useEngine } from "../lib/engine-client";
import { FALLBACK_QUERY, MAX_QUERY_LENGTH, queryFromPath } from "../lib/not-found";
import "./not-found.css";

const LIMIT = 8;
/** The places in the results list; cells are keyed by place (see the list below). */
const CELLS = Array.from({ length: LIMIT }, (_, i) => `cell-${i}`);
const MAX_PATH_SHOWN = 40;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function formatMs(ms: number): string {
  if (ms < 0.1) return "< 0.1 ms";
  return ms < 1 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}

/** The address as the visitor typed it: decoded, and cut when it is long. */
function displayPath(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURI(pathname);
  } catch {
    // A malformed escape: show the raw address.
  }
  return path.length > MAX_PATH_SHOWN ? `${path.slice(0, MAX_PATH_SHOWN - 1)}…` : path;
}

/**
 * The 404 page searches emoji for the words in the missing address. It uses only the on-device
 * engine: the address can hold private data, so it never goes to the API.
 */
export function NotFoundSearch() {
  // English answers at once; every language loads on an idle desktop or when the visitor types.
  const { engine, ready } = useEngine({ upgrade: "idle" });
  const [path, setPath] = useState<string>();
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(true);
  const [highlight, setHighlight] = useState<{ query: string; index: number }>();
  const [copied, setCopied] = useState<string>();
  const id = useId();
  const hasEngine = engine !== undefined;

  // The page is static, so the address is read after hydration.
  useEffect(() => {
    const { pathname } = window.location;
    setPath(pathname);
    setTarget(queryFromPath(pathname) || FALLBACK_QUERY);
  }, []);

  // Types the words from the address once, then hands the box to the visitor.
  useEffect(() => {
    if (!hasEngine || !target || !typing) return;
    if (reducedMotion()) {
      setQuery(target);
      setTyping(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const chars = [...target];
      await wait(280);
      for (let n = 1; n <= chars.length && !cancelled; n++) {
        setQuery(chars.slice(0, n).join(""));
        await wait(40 + Math.random() * 45);
      }
      if (!cancelled) setTyping(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasEngine, target, typing]);

  const search = useMemo(() => {
    if (!engine || !query.trim()) return { results: [] as AliasResult[], ms: undefined };
    const start = performance.now();
    const { results } = engine.search(query, {
      limit: LIMIT,
      culture: false,
      locale: pageLocale(),
      locales: searchLocales(),
    });
    return { results, ms: performance.now() - start };
  }, [engine, query]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const label = (result: AliasResult) => engine?.get(result.id)?.labels.en ?? result.label;
  // A new query highlights its first result again.
  const active = highlight?.query === query ? highlight.index : 0;
  const current = search.results[active];

  const copy = async (result: AliasResult) => {
    try {
      await navigator.clipboard.writeText(result.emoji);
      setCopied(`${result.emoji} ${label(result)}`);
    } catch {
      // Clipboard access can be refused; the emoji stays visible to copy by hand.
    }
  };

  const status = (() => {
    if (copied) return <>Copied {copied}</>;
    if (ready === "failed") return "The emoji dictionary did not load. The links below still work.";
    if (!engine) return "Loading the emoji dictionary…";
    if (current) {
      return (
        <>
          <span className="nf-name">{label(current)}</span>
          <span className="nf-sep" aria-hidden="true">
            ·
          </span>
          matched <q>{current.match}</q>
        </>
      );
    }
    if (query.trim() && !typing) return "No match for that. Try another word.";
    return " ";
  })();

  return (
    <div className="nf">
      <p className="nf-asked">
        {path ? (
          <>
            Nothing lives at <code className="nf-path">{displayPath(path)}</code>, so we searched it for emoji
            instead.
          </>
        ) : (
          "Nothing lives at this address, so we searched it for emoji instead."
        )}
      </p>

      <div className="nf-box">
        <div className="nf-bar">
          <svg className="nf-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <label className="visually-hidden" htmlFor={`${id}-q`}>
            Search emoji
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Search emoji…"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-status`}
            onFocus={() => {
              setTyping(false);
              fullEngine().catch(() => {});
            }}
            onChange={(event) => {
              setTyping(false);
              setQuery(event.target.value);
            }}
          />
          {search.ms !== undefined && (
            <span className="nf-timing">
              <span className="nf-dot" aria-hidden="true" />
              {formatMs(search.ms)} · on your device
            </span>
          )}
        </div>

        {/*
          Always LIMIT cells, keyed by place: the list keeps its height while the words are typed,
          and a new answer replaces a cell instead of moving the others (no layout shift).
        */}
        <ul className="nf-results" aria-label="Emoji results. Select one to copy it.">
          {CELLS.map((cell, i) => {
            const result = search.results[i];
            if (!engine && ready !== "failed") return <li key={cell} className="nf-tile nf-skeleton" />;
            if (!result) return <li key={cell} className="nf-empty" aria-hidden="true" />;
            return (
              <li key={`${cell}-${result.id}`}>
                <button
                  type="button"
                  className="nf-tile"
                  aria-label={`Copy ${label(result)}`}
                  data-active={i === active ? "" : undefined}
                  style={{ animationDelay: `${i * 28}ms` }}
                  onMouseEnter={() => setHighlight({ query, index: i })}
                  onFocus={() => setHighlight({ query, index: i })}
                  onClick={() => copy(result)}
                >
                  <span className="emoji">{result.emoji}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="nf-status" id={`${id}-status`} aria-live="polite">
          {status}
        </p>
      </div>

      <p className="nf-note">
        Searched in your browser with the open-source engine. The address never left this page.
      </p>
    </div>
  );
}
