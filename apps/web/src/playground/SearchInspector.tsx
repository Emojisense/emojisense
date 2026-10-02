import type { AliasEngine, SearchResult } from "emojisense";
import { type KeyboardEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { API_URL, PACK_VERSION } from "../config";
import type { EngineState } from "../lib/engine-client";
import { SEARCH_COPY } from "../lib/search-copy";
import { CodePanel } from "./CodePanel";
import { type HealthState, useCopy } from "./hooks";
import { countNameMatches } from "./lib/baseline";
import type { TracedSemantic } from "./lib/edge";
import { SEARCH_EXAMPLES } from "./lib/examples";
import {
  LIMIT_OPTIONS,
  LOCALE_NAMES,
  LOCALES,
  type Locale,
  MODE_NAMES,
  MODES,
  type Mode,
  type SearchSettings,
} from "./lib/settings";
import { type CodeSample, searchSnippets } from "./lib/snippets";
import { ResultDetails } from "./ResultDetails";
import { emptyMessage, SearchResults, VIEWS, type View } from "./SearchResults";
import { SearchTiming, useSessionStats } from "./SearchTiming";
import { useSearchRun } from "./useSearchRun";

const MODE_NOTES: Record<Mode, string> = {
  alias:
    "The dictionary in this browser answers every keystroke. No request is sent, so it also works offline.",
  hybrid:
    "The dictionary answers at once. When it is unsure, the SDK asks the edge for meaning and fuses both lists.",
  semantic: "Only the edge meaning search (Workers AI embeddings), one request for each pause in typing.",
};

const ENDPOINTS = { api: API_URL, packVersion: PACK_VERSION };

export interface SearchInspectorProps {
  engine: AliasEngine | undefined;
  ready: EngineState["ready"];
  online: boolean;
  health: HealthState;
  traced: TracedSemantic;
  settings: SearchSettings;
  onChange: (patch: Partial<SearchSettings>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  codeTab: CodeSample["id"];
  onCodeTab: (id: CodeSample["id"]) => void;
  announce: (message: string) => void;
}

/** Search inspector: every setting of the SDK and the API, each result explained, every millisecond shown. */
export function SearchInspector(props: SearchInspectorProps) {
  const { engine, ready, online, health, traced, settings, onChange, inputRef, announce } = props;
  const { query, locale, mode, limit, alwaysEdge } = settings;
  const run = useSearchRun({ engine, online, traced, settings });
  const [active, setActive] = useState(0);
  const [view, setView] = useState<View>("grid");
  const gridRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();
  const stats = useSessionStats(run);
  const id = useId();

  const results = query.trim() ? (run?.results ?? []) : [];
  // The on-device mode has no semantic list: it never calls a query unsure.
  const guessing = mode !== "alias" && run?.unsure === true;
  const resultKey = results.map((r) => r.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new result list starts at its first item.
  useEffect(() => setActive(0), [resultKey]);
  const selected = results[active];

  const label = (result: SearchResult) =>
    engine?.get(result.id)?.labels[locale] ?? engine?.get(result.id)?.labels.en ?? result.id;
  const aliasHit = (result: SearchResult) => run?.alias?.results.find((r) => r.id === result.id);
  const snippets = useMemo(() => searchSnippets(settings, ENDPOINTS), [settings]);
  const nameMatches = useMemo(
    () => (engine ? countNameMatches(engine.entries, query, locale) : undefined),
    [engine, query, locale],
  );
  const loadingLocale = locale !== "en" && ready === "english";

  const select = (index: number) => {
    setActive(index);
    const result = results[index];
    if (result) announce(`${label(result)}, ${index + 1} of ${results.length}`);
  };

  const copyEmoji = async (result: SearchResult) => {
    if (await copy(result.emoji, `emoji:${result.id}`)) announce(`Copied ${result.emoji} ${label(result)}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) onChange({ query: "" });
      else event.currentTarget.blur();
      return;
    }
    if (results.length === 0) return;
    const grid = gridRef.current;
    const columns =
      view === "grid" && grid
        ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
        : 1;
    const caretAtEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
    const moves: Record<string, number> = {
      ArrowDown: columns,
      ArrowUp: -columns,
      // Left and right move through results only from the end of the text, so the caret still works.
      ...(caretAtEnd && view === "grid" ? { ArrowRight: 1, ...(active > 0 ? { ArrowLeft: -1 } : {}) } : {}),
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      select(Math.min(results.length - 1, Math.max(0, active + move)));
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      void copyEmoji(selected);
    }
  };

  return (
    <div className="pg-search">
      <div className="pg-query">
        <svg className="pg-query-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <label className="visually-hidden" htmlFor={`${id}-q`}>
          Search emoji
        </label>
        <input
          ref={inputRef}
          id={`${id}-q`}
          type="text"
          value={query}
          maxLength={64}
          placeholder="A word, a feeling, a film, a typo…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={selected && view === "grid" ? `${id}-r${active}` : undefined}
          onChange={(event) => onChange({ query: event.target.value })}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className="pg-query-clear"
            aria-label="Clear the search"
            onClick={() => {
              onChange({ query: "" });
              inputRef.current?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </button>
        )}
        <kbd className="pg-kbd pg-query-kbd" title="Press / to search">
          /
        </kbd>
      </div>

      <div className="pg-controls">
        <label className="pg-field">
          <span className="pg-label">Locale</span>
          <select
            className="pg-select"
            value={locale}
            onChange={(event) => onChange({ locale: event.target.value as Locale })}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_NAMES[code]} · {code}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="pg-field pg-field-mode">
          <legend className="pg-label">Mode</legend>
          <div className="pg-segmented">
            {MODES.map((value) => (
              <label key={value} data-checked={mode === value || undefined}>
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => onChange({ mode: value })}
                />
                {MODE_NAMES[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="pg-field">
          <span className="pg-label">Limit</span>
          <select
            className="pg-select"
            value={limit}
            onChange={(event) => onChange({ limit: Number(event.target.value) })}
          >
            {[...new Set([...LIMIT_OPTIONS, limit])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
          </select>
        </label>
        {mode === "hybrid" && (
          <label className="pg-switch">
            <input
              type="checkbox"
              role="switch"
              aria-checked={alwaysEdge}
              checked={alwaysEdge}
              onChange={(event) => onChange({ alwaysEdge: event.target.checked })}
            />
            <span className="pg-switch-track" aria-hidden="true" />
            Always ask the edge
          </label>
        )}
      </div>
      <p className="pg-note">{MODE_NOTES[mode]}</p>

      <div className="pg-examples">
        <span className="pg-label">Try</span>
        {SEARCH_EXAMPLES.map((example) => (
          <button
            key={example.query}
            type="button"
            className="pg-chip"
            aria-pressed={query === example.query && locale === example.locale}
            onClick={() => {
              onChange({ query: example.query, locale: example.locale });
              inputRef.current?.focus();
            }}
          >
            {example.query}
            <span className="pg-chip-tag">{example.kind}</span>
          </button>
        ))}
      </div>

      <div className="pg-main">
        <section className="pg-panel pg-results" aria-labelledby={`${id}-results`}>
          <header className="pg-panel-head">
            <h2 id={`${id}-results`} className="pg-label">
              Results
            </h2>
            <span className="pg-count" aria-live="polite">
              {results.length > 0 ? `${results.length} of ${limit}` : ""}
            </span>
            {nameMatches !== undefined && query.trim() && (
              <span className="pg-baseline" title="A substring match on emoji names, as most pickers do">
                Name search alone: {nameMatches}
              </span>
            )}
            <fieldset className="pg-views">
              <legend className="visually-hidden">View</legend>
              {VIEWS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          </header>

          {results.length > 0 && guessing && (
            <p className="pg-honesty" role="status">
              {SEARCH_COPY.unsure}
            </p>
          )}
          <div className="pg-results-body" aria-busy={run?.edge.kind === "waiting" && mode === "semantic"}>
            <SearchResults
              guessing={guessing}
              id={id}
              view={view}
              gridRef={gridRef}
              results={results}
              active={active}
              onSelect={select}
              label={label}
              aliasHit={aliasHit}
              mode={mode}
              empty={emptyMessage({ engine, ready, query, mode, run, online })}
              onMode={(next) => onChange({ mode: next })}
              loading={!engine && ready !== "failed" && mode !== "semantic"}
            />
          </div>
          <footer className="pg-panel-foot">
            {loadingLocale ? (
              <span className="pg-loading">Loading {LOCALE_NAMES[locale]} and the other languages…</span>
            ) : (
              <span className="pg-legend" aria-hidden="true">
                <span data-source="alias">Dictionary</span>
                <span data-source="semantic">Meaning</span>
                <span className="pg-legend-hint">Scores compare within one source</span>
              </span>
            )}
            <span className="pg-keys" aria-hidden="true">
              <kbd className="pg-kbd">↑</kbd>
              <kbd className="pg-kbd">↓</kbd> move <kbd className="pg-kbd">↵</kbd> copy{" "}
              <kbd className="pg-kbd">esc</kbd> clear
            </span>
          </footer>
        </section>

        <aside className="pg-side">
          <ResultDetails
            result={selected}
            rank={active + 1}
            total={results.length}
            engine={engine}
            locale={locale}
            hit={selected ? aliasHit(selected) : undefined}
            model={health.kind === "up" ? health.health.model : undefined}
            copied={copied}
            onCopy={copy}
            onCopyEmoji={copyEmoji}
          />
          <SearchTiming run={query.trim() ? run : undefined} mode={mode} stats={stats} />
        </aside>
      </div>

      <CodePanel
        title="Copy as code"
        samples={snippets}
        selected={props.codeTab}
        onSelect={props.onCodeTab}
      />
    </div>
  );
}
