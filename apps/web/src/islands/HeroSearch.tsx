import { useEmojiSearch, useEmojisense } from "@emojisense/react";
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Example } from "../content/landing";
import { describeAnswer, semanticLayerOf } from "../lib/answer";
import { type BurstPiece, burstPieces, prefersReducedMotion, settledAnswer, tiltFor } from "../lib/celebrate";
import { codePointLabel } from "../lib/format";
import "./hero-search.css";

export interface HeroSearchProps {
  apiUrl: string;
  packBaseUrl: string;
  publishableKey: string;
  initialQuery: string;
  examples: Example[];
}

const RESULT_LIMIT = 8;
/** The top answer must stay the same this long before it gets a celebration. */
const SETTLE_MS = 450;
const BURST_MS = 650;
const BURST_PIECES = 8;

const LAYER_LABEL = { device: "📱 device", shard: "🗂️ shard", api: "☁️ Worker" } as const;

interface Burst {
  key: number;
  emoji: string;
  pieces: BurstPiece[];
}

/** The landing page's live search: the real SDK, the real packs, the real API. */
export function HeroSearch(props: HeroSearchProps) {
  const { apiUrl, packBaseUrl, publishableKey, initialQuery, examples } = props;
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [burst, setBurst] = useState<Burst | undefined>();
  const celebrated = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const listboxId = useId();
  const sense = useEmojisense({ packBaseUrl, endpoint: apiUrl, publishableKey });
  const search = useEmojiSearch(query, sense, { limit: RESULT_LIMIT });
  const { results } = search;
  const top = results[0];
  const layer = semanticLayerOf(search);

  const settled = settledAnswer(search);
  const settledId = settled?.id;
  const settledEmoji = settled?.emoji;

  // One celebration per new answer, after the typing pauses. Never with reduced motion.
  useEffect(() => {
    if (!settledId || !settledEmoji || settledId === celebrated.current) return;
    const timer = setTimeout(() => {
      celebrated.current = settledId;
      if (prefersReducedMotion()) return;
      setBurst({ key: Date.now(), emoji: settledEmoji, pieces: burstPieces(BURST_PIECES, settledId) });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settledId, settledEmoji]);

  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(undefined), BURST_MS);
    return () => clearTimeout(timer);
  }, [burst]);

  const labelOf = (id: string) => sense.engine?.get(id)?.labels.en ?? "";

  const changeQuery = (next: string) => {
    setQuery(next);
    setActiveIndex(0);
  };

  const nextExample = () => {
    const current = examples.findIndex((example) => example.query === query);
    const next = examples[(current + 1) % examples.length];
    if (next) changeQuery(next.query);
    inputRef.current?.focus();
  };

  const copy = (emoji: string, id: string) => {
    void navigator.clipboard?.writeText(emoji).catch(() => {});
    setAnnouncement(`Copied ${emoji} ${labelOf(id)}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    const caretAtEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 };
    const move = moves[event.key];
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (move !== undefined && (!horizontal || caretAtEnd)) {
      event.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, Math.max(0, i + move)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) copy(result.emoji, result.id);
    }
  };

  const readout =
    sense.status === "error"
      ? `Could not load the dictionary from ${new URL(packBaseUrl).host}. Try again in a minute.`
      : sense.status === "loading"
        ? "Loading the on-device dictionary…"
        : describeAnswer(search);

  return (
    <div className="playground card" data-state={sense.status}>
      <div className="composer">
        <button
          type="button"
          className="composer-dice keycap"
          onClick={nextExample}
          aria-label="Try another example"
          title="Try another example"
        >
          <span aria-hidden="true">🎲</span>
        </button>
        <label htmlFor={inputId} className="visually-hidden">
          Search emoji
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          placeholder="Type what you mean…"
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-describedby={`${inputId}-readout`}
        />
        <div className="composer-answer" aria-hidden="true">
          {top ? (
            <span
              key={top.id}
              className="sticker answer-sticker"
              style={{ "--tilt": `${tiltFor(top.id)}deg` } as CSSProperties}
            >
              {top.emoji}
            </span>
          ) : (
            <span className="answer-empty">{sense.status === "loading" ? "⏳" : "🫥"}</span>
          )}
          {burst && (
            <span className="burst" key={burst.key}>
              {burst.pieces.map((piece, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: pieces are a fixed, positional set.
                  key={index}
                  style={
                    {
                      "--dx": `${piece.dx}rem`,
                      "--dy": `${piece.dy}rem`,
                      "--r": `${piece.rotate}deg`,
                      "--s": piece.scale,
                      animationDelay: `${piece.delayMs}ms`,
                    } as CSSProperties
                  }
                >
                  {burst.emoji}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="results" role="listbox" id={listboxId} aria-label="Results">
        {results.map((result, index) => (
          // Combobox pattern: focus stays in the input, which moves aria-activedescendant and handles
          // the keys. The options themselves are intentionally not focusable.
          // biome-ignore lint/a11y/useFocusableInteractive: see above.
          // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
          <div
            key={result.id}
            id={`${listboxId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            aria-label={labelOf(result.id) || result.emoji}
            className="keycap result-key"
            data-source={result.source}
            style={{ "--i": index } as CSSProperties}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => copy(result.emoji, result.id)}
          >
            <span className="result-glyph">{result.emoji}</span>
            <span className="result-hex">{codePointLabel(result.id).slice(2)}</span>
          </div>
        ))}
      </div>

      <p className="readout" id={`${inputId}-readout`}>
        {layer && <span className="readout-layer">{LAYER_LABEL[layer]}</span>}
        <span>{readout}</span>
      </p>

      <div className="examples">
        <span className="examples-label">Try</span>
        <ul>
          {examples.map((example) => (
            <li key={example.query}>
              <button
                type="button"
                className="pill"
                aria-pressed={query === example.query}
                onClick={() => changeQuery(example.query)}
              >
                <span className="emoji" aria-hidden="true">
                  {example.emoji}
                </span>
                {example.query}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
