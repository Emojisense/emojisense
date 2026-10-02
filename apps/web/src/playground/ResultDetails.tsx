import { type AliasEngine, type AliasResult, groupLabel, type SearchResult } from "emojisense";
import type { CSSProperties } from "react";
import { FIELD_NAMES, SOURCE_NAMES } from "./lib/labels";
import type { Locale } from "./lib/settings";

export interface ResultDetailsProps {
  result: SearchResult | undefined;
  rank: number;
  total: number;
  engine: AliasEngine | undefined;
  locale: Locale;
  hit: AliasResult | undefined;
  model: string | undefined;
  copied: string | undefined;
  onCopy: (text: string, id?: string) => Promise<boolean>;
  onCopyEmoji: (result: SearchResult) => void;
}

/** Why one result matched: score, source, phrase and field, and the emoji's own facts. */
export function ResultDetails({
  result,
  rank,
  total,
  engine,
  locale,
  hit,
  model,
  copied,
  onCopy,
  onCopyEmoji,
}: ResultDetailsProps) {
  if (!result) {
    return (
      <section className="pg-panel pg-inspector" aria-label="Result details">
        <header className="pg-panel-head">
          <h3 className="pg-label">Details</h3>
        </header>
        <p className="pg-quiet">Pick a result to see why it matched.</p>
      </section>
    );
  }
  const entry = engine?.get(result.id);
  const name = entry?.labels[locale] ?? entry?.labels.en ?? result.id;
  const english = locale !== "en" ? entry?.labels.en : undefined;
  const json = JSON.stringify(result);

  return (
    <section className="pg-panel pg-inspector" aria-label="Result details">
      <header className="pg-panel-head">
        <h3 className="pg-label">Details</h3>
        <span className="pg-count">
          #{rank} of {total}
        </span>
      </header>
      <div className="pg-inspector-hero" key={result.id}>
        <span className="emoji pg-inspector-emoji">{result.emoji}</span>
        <div>
          <p className="pg-inspector-name">{name}</p>
          {english && english !== name && <p className="pg-quiet">{english}</p>}
        </div>
      </div>
      <dl className="pg-facts">
        <div>
          <dt>ID</dt>
          <dd className="pg-mono">{result.id}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd className="pg-score">
            <span className="pg-score-track" aria-hidden="true">
              <span style={{ "--w": `${Math.min(1, result.score) * 100}%` } as CSSProperties} />
            </span>
            <span className="pg-mono">{result.score.toFixed(3)}</span>
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            <span className="pg-source" data-source={result.source}>
              {SOURCE_NAMES[result.source]}
            </span>
            <span className="pg-quiet">
              {result.source === "alias" ? " on device" : result.source === "semantic" ? " at the edge" : ""}
            </span>
          </dd>
        </div>
        <div>
          <dt>Matched</dt>
          <dd>
            {result.source === "alias" && hit ? (
              <>
                “{hit.match}” <span className="pg-quiet">· {FIELD_NAMES[hit.field]}</span>
              </>
            ) : result.source === "semantic" ? (
              <>
                By meaning{model ? <span className="pg-quiet"> · {model}</span> : null}
                {hit && <span className="pg-quiet"> · dictionary also has “{hit.match}”</span>}
              </>
            ) : (
              "–"
            )}
          </dd>
        </div>
        {entry && (
          <>
            <div>
              <dt>Group</dt>
              <dd>{groupLabel(entry.group, locale)}</dd>
            </div>
            <div>
              <dt>Since</dt>
              <dd>
                Emoji {entry.version}
                {entry.hasSkinTones ? <span className="pg-quiet"> · skin tones</span> : null}
              </dd>
            </div>
          </>
        )}
      </dl>
      <div className="pg-actions">
        <button type="button" className="pg-button" onClick={() => onCopyEmoji(result)}>
          {copied === `emoji:${result.id}` ? "Copied" : "Copy emoji"}
        </button>
        <button
          type="button"
          className="pg-button pg-button-quiet"
          onClick={() => onCopy(json, `json:${result.id}`)}
        >
          {copied === `json:${result.id}` ? "Copied" : "Copy JSON"}
        </button>
      </div>
    </section>
  );
}
