import type { AliasEngine, AliasResult, SearchResult } from "emojisense";
import type { CSSProperties, RefObject } from "react";
import type { EngineState } from "../lib/engine-client";
import { SOURCE_NAMES } from "./lib/labels";
import { MODE_NAMES, type Mode } from "./lib/settings";
import type { SearchRun } from "./useSearchRun";

export type View = "grid" | "table" | "json";
export const VIEWS: { id: View; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "table", label: "Table" },
  { id: "json", label: "JSON" },
];

export function emptyMessage(input: {
  engine: AliasEngine | undefined;
  ready: EngineState["ready"];
  query: string;
  mode: Mode;
  run: SearchRun | undefined;
  online: boolean;
}): { text: string; action?: Mode } {
  const { engine, ready, query, mode, run, online } = input;
  if (mode === "semantic") {
    if (!query.trim())
      return { text: "Type a phrase. The edge searches by meaning, in any of the 11 languages." };
    if (!online)
      return { text: "Meaning search needs the network. On device works offline.", action: "alias" };
    if (run?.edge.kind === "failed")
      return { text: `${run.edge.message} On device still works.`, action: "alias" };
    if (run?.edge.kind === "waiting") return { text: "Asking the edge…" };
    if (run?.edge.kind === "empty")
      return { text: "The edge had no answer for this query. Try another phrase." };
    return { text: `The edge found nothing for “${query.trim()}”.` };
  }
  if (ready === "failed") {
    return {
      text: "The on-device dictionary could not load. Check the connection, then reload. Meaning only can still work.",
      action: "semantic",
    };
  }
  if (!engine) return { text: "Loading the on-device dictionary…" };
  if (!query.trim()) return { text: "Type a word, a feeling, a film or a typo. Press / to start." };
  if (mode === "alias") {
    return {
      text: `No emoji on this device for “${query.trim()}”. Hybrid also asks the edge for meaning.`,
      action: "hybrid",
    };
  }
  if (run?.edge.kind === "waiting") return { text: "Asking the edge…" };
  return { text: `No emoji for “${query.trim()}”. Try fewer words or another language.` };
}

export interface SearchResultsProps {
  id: string;
  view: View;
  gridRef: RefObject<HTMLDivElement | null>;
  results: SearchResult[];
  active: number;
  onSelect: (index: number) => void;
  label: (result: SearchResult) => string;
  aliasHit: (result: SearchResult) => AliasResult | undefined;
  mode: Mode;
  empty: { text: string; action?: Mode };
  onMode: (mode: Mode) => void;
  loading: boolean;
  /** No tier understood the query: the tiles are guesses, shown dimmed. */
  guessing?: boolean;
}

/** The result list as a grid, a table or the raw JSON the SDK returned. */
export function SearchResults(props: SearchResultsProps) {
  const { id, view, results, active, onSelect, label, aliasHit } = props;

  if (props.loading) {
    return (
      <div className="pg-grid" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders that never reorder.
          <span key={i} className="pg-tile pg-skeleton" />
        ))}
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="pg-empty" role="status">
        <span className="emoji pg-empty-emoji" aria-hidden="true">
          🫥
        </span>
        <p>{props.empty.text}</p>
        {props.empty.action && (
          <button
            type="button"
            className="pg-button pg-button-quiet"
            onClick={() => props.onMode(props.empty.action as Mode)}
          >
            Switch to {MODE_NAMES[props.empty.action]}
          </button>
        )}
      </div>
    );
  }

  if (view === "json") {
    const expression =
      props.mode === "alias"
        ? "engine.search(…).results"
        : props.mode === "hybrid"
          ? "state.results"
          : "response.results";
    return (
      <figure className="pg-json">
        <figcaption className="pg-label">{expression}</figcaption>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be reachable by keyboard. */}
        <pre tabIndex={0}>
          <code>{JSON.stringify(results, null, 2)}</code>
        </pre>
      </figure>
    );
  }

  if (view === "table") {
    return (
      <div className="pg-table-wrap">
        <table className="pg-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Emoji</th>
              <th scope="col">Name</th>
              <th scope="col">ID</th>
              <th scope="col">Score</th>
              <th scope="col">Source</th>
              <th scope="col">Matched</th>
            </tr>
          </thead>
          <tbody id={`${id}-list`}>
            {results.map((result, index) => {
              const hit = result.source === "alias" ? aliasHit(result) : undefined;
              return (
                // The search box moves the active row with the arrow keys; a click is a shortcut.
                <tr
                  key={result.id}
                  id={`${id}-r${index}`}
                  data-active={index === active || undefined}
                  onClick={() => onSelect(index)}
                >
                  <td className="pg-num">{index + 1}</td>
                  <td>
                    <span className="emoji pg-table-emoji">{result.emoji}</span>
                  </td>
                  <td>{label(result)}</td>
                  <td className="pg-mono">{result.id}</td>
                  <td className="pg-num">{result.score.toFixed(3)}</td>
                  <td>
                    <span className="pg-source" data-source={result.source}>
                      {SOURCE_NAMES[result.source]}
                    </span>
                  </td>
                  <td>{hit ? `“${hit.match}”` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div
      className="pg-grid"
      id={`${id}-list`}
      role="listbox"
      aria-label="Emoji results"
      ref={props.gridRef}
      data-guessing={props.guessing || undefined}
    >
      {results.map((result, index) => (
        // Combobox pattern: focus stays in the search box, which moves aria-activedescendant.
        // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the search box (see above).
        // biome-ignore lint/a11y/useFocusableInteractive: see above.
        <div
          key={result.id}
          id={`${id}-r${index}`}
          role="option"
          aria-selected={index === active}
          aria-label={`${label(result)}, score ${result.score.toFixed(2)}, ${SOURCE_NAMES[result.source]}`}
          className="pg-tile"
          data-source={result.source}
          style={{ "--i": index } as CSSProperties}
          onClick={() => onSelect(index)}
        >
          <span className="emoji pg-tile-emoji">{result.emoji}</span>
          <span className="pg-tile-score">{result.score.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
