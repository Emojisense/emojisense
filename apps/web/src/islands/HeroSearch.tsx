import { createSearchSession, type SearchResult, type SessionState } from "emojisense";
import { Fragment, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Messages } from "../i18n/catalogs";
import type { HeroExample } from "../i18n/examples";
import { rich, useTranslator } from "../i18n/react";
import {
  fullEngine,
  labelOf,
  pageLocale,
  sharedSemantic,
  sharedStats,
  useEngine,
} from "../lib/engine-client";
import "./hero-search.css";

/** One row of 12 on wide screens, two rows of 6 on phones (hero-search.css). */
const LIMIT = 12;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function formatMs(ms: number, lang: string): string {
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(
      value,
    );
  if (ms < 0.1) return `< ${number(0.1, 1)} ms`;
  return ms < 1 ? `${number(ms, 2)} ms` : `${number(ms, 0)} ms`;
}

export interface HeroSearchProps {
  messages: Messages["hero"];
  /** Intl tag of the page ("es", "zh-Hans"). */
  lang: string;
  /** Example searches, the page's own language first. `lang` marks the others. */
  examples: HeroExample[];
}

/** The hero: one big search box running the real engine in the visitor's browser. */
export function HeroSearch({ messages, lang, examples }: HeroSearchProps) {
  const t = useTranslator(messages, lang);
  // The page's language answers the first keystroke; the others wait for interest or an idle page.
  const { engine, ready } = useEngine({ upgrade: "idle" });
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SessionState | undefined>();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [example, setExample] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const exampleRef = useRef(0);
  /** Only the visitor's own typing is reported, never the autoplay. */
  const visitorRef = useRef(false);
  visitorRef.current = !auto;
  const id = useId();
  const multilingual = ready === "all";
  const locale = useMemo(() => pageLocale(), []);
  // An example in another language is ranked as that language; the visitor's own typing as the page's.
  const searchLocale = (auto && examples[example]?.lang) || locale;
  const firstLocales = useMemo(() => new Set(["en", locale]), [locale]);
  const languageNames = useMemo(() => new Intl.DisplayNames([lang], { type: "language" }), [lang]);

  const session = useMemo(() => {
    if (!engine) return undefined;
    const semantic = sharedSemantic();
    return createSearchSession({
      engine,
      ...(semantic ? { semantic } : {}),
      locale: searchLocale,
      limit: LIMIT,
      debounceMs: 160,
      onChange: (next) => {
        setState(next);
        if (visitorRef.current) sharedStats()?.observe(next);
      },
    });
  }, [engine, searchLocale]);

  useEffect(() => {
    session?.update(query);
    setActive(0);
  }, [session, query]);
  useEffect(() => () => session?.dispose(), [session]);

  // Types the examples until the visitor takes over. Under reduced motion it shows the first one.
  // Examples in a language the first engine lacks join once those packs are loaded, so none shows
  // a guess from the wrong language.
  useEffect(() => {
    if (!auto || paused || !engine) return;
    if (reducedMotion()) {
      setQuery(examples[0]?.query ?? "");
      return;
    }
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        const i = exampleRef.current;
        const current = examples[i];
        if (!current || (current.lang && !firstLocales.has(current.lang) && !multilingual)) {
          exampleRef.current = (i + 1) % examples.length;
          continue;
        }
        const chars = [...current.query];
        setExample(i);
        for (let n = 1; n <= chars.length && !cancelled; n++) {
          setQuery(chars.slice(0, n).join(""));
          await wait(55 + Math.random() * 70);
        }
        await wait(2200);
        // Cleared at once: erasing letter by letter replays a result set per letter.
        if (!cancelled) setQuery("");
        await wait(260);
        if (!cancelled) exampleRef.current = (i + 1) % examples.length;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auto, paused, engine, multilingual, examples, firstLocales]);

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
  const label = (r: SearchResult) => labelOf(engine, r.id, locale) ?? r.emoji;
  const matched = current && state?.alias.results.find((r) => r.id === current.id)?.match;
  const loading = !engine && ready !== "failed";
  const shown = examples[example];
  // A query in another language is named by its language ("Spanish"); the rest by what it shows.
  const kindOf = (e: HeroExample | undefined) =>
    !e ? "" : e.lang && e.lang !== "en" ? (languageNames.of(e.lang) ?? e.lang) : t.t(`kinds.${e.kind}`);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    // In a right-to-left page the arrows follow the reading direction.
    const rtl = event.currentTarget.closest("[dir=rtl]") !== null;
    const move = step[event.key];
    if (move !== undefined && results.length > 0) {
      event.preventDefault();
      const signed = rtl && (event.key === "ArrowRight" || event.key === "ArrowLeft") ? -move : move;
      setActive((i) => (i + signed + results.length) % results.length);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };

  const timing = (() => {
    if (!state || !query.trim()) return undefined;
    if (state.status === "fused" && state.semanticMs !== undefined) {
      return state.semanticCached
        ? t.t("edgeCache")
        : t.t("edgeAi", { ms: formatMs(state.semanticMs, lang) });
    }
    return t.t("onDevice", { ms: formatMs(state.aliasMs, lang) });
  })();

  return (
    <div className="hs">
      <div className="hs-bar">
        {auto && (
          // The autoplay fills the box, so without this tab it reads as an animation, not an input.
          // A label focuses the input on click; it is hidden from screen readers, as focus ends the demo.
          <label className="hs-hint" htmlFor={`${id}-q`} aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2.5" y="6" width="19" height="12" rx="2" />
              <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
            </svg>
            {t.t("typeHint")}
          </label>
        )}
        <svg className="hs-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <label className="visually-hidden" htmlFor={`${id}-q`}>
          {t.t("searchLabel")}
        </label>
        <input
          id={`${id}-q`}
          ref={inputRef}
          value={query}
          placeholder={t.t("placeholder")}
          autoComplete="off"
          spellCheck={false}
          dir="auto"
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
            t.t("offline")
          ) : null}
        </span>
      </div>

      <div className="hs-results">
        <div
          className="hs-list"
          id={`${id}-list`}
          role="listbox"
          aria-label={t.t("results")}
          aria-busy={loading || undefined}
        >
          {loading &&
            Array.from({ length: LIMIT }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders that never reorder.
              <span key={i} className="hs-tile hs-skeleton" aria-hidden="true" />
            ))}
          {/* Tiles keep their place and only their emoji is replaced, so new results never shift the layout.
              The emoji is not keyed: it swaps in place on each keystroke, at the engine's speed. */}
          {results.map((r, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: one tile per slot; only a new slot fades in.
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
              <span className="emoji">{r.emoji}</span>
            </button>
          ))}
        </div>
        {engine && query.trim() && results.length === 0 && <p className="hs-empty">{t.t("empty")}</p>}
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
            {current.source === "semantic"
              ? t.t("byMeaning")
              : matched
                ? rich(t.raw("matched"), { q: (text) => <q dir="auto">{text}</q> }, { match: matched })
                : t.t("bestMatch")}
            {auto && <span className="hs-kind">{kindOf(shown)}</span>}
          </Fragment>
        ) : (
          t.t("idle")
        )}
      </p>

      <div className="hs-try">
        <span className="hs-try-label">{t.t("try")}</span>
        {examples.map((e, i) => (
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
            {paused ? t.t("play") : t.t("pause")}
          </button>
        )}
      </div>
    </div>
  );
}
