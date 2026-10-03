import type { AliasEngine, SearchResult } from "emojisense";
import {
  type KeyboardEvent,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { API_URL, PACK_VERSION } from "../config";
import { CodePanel } from "./CodePanel";
import { type EdgeOutcome, serverTotal, suggestReactions } from "./lib/edge";
import { REACTION_EXAMPLES } from "./lib/examples";
import { SOURCE_NAMES } from "./lib/labels";
import { LOCALE_NAMES, LOCALES, type Locale } from "./lib/settings";
import { type CodeSample, reactionSnippets } from "./lib/snippets";
import { TimingBars, type TimingRow } from "./TimingBars";

/** The API reads this many characters of a message (docs/API.md). */
const API_CHARS = 256;
const LIMITS = [4, 6, 8, 12] as const;
const PREVIEW_COUNT = 6;
const ENDPOINTS = { api: API_URL, packVersion: PACK_VERSION };

interface Input {
  text: string;
  locale: Locale;
  limit: number;
}

type EdgeState = { kind: "loading" } | { kind: "offline" } | { kind: "done"; outcome: EdgeOutcome };

export interface ReactionsLabProps {
  engine: AliasEngine | undefined;
  online: boolean;
  codeTab: CodeSample["id"];
  onCodeTab: (id: CodeSample["id"]) => void;
  announce: (message: string) => void;
}

const FIRST = REACTION_EXAMPLES[0] ?? { text: "", locale: "en" as const };

/** Paste a message, get the reactions people would add: edge first, the device as the fallback. */
export function ReactionsLab({ engine, online, codeTab, onCodeTab, announce }: ReactionsLabProps) {
  const [draft, setDraft] = useState<Input>({ text: FIRST.text, locale: FIRST.locale, limit: 8 });
  const [sent, setSent] = useState<Input | undefined>();
  const [edge, setEdge] = useState<EdgeState | undefined>();
  const [reacted, setReacted] = useState<ReadonlySet<string>>(new Set());
  const request = useRef<AbortController | undefined>(undefined);
  const mac = useIsMac();
  const id = useId();

  const send = useCallback(
    async (input: Input) => {
      const text = input.text.trim();
      if (!text) return;
      request.current?.abort();
      setSent({ ...input, text });
      setReacted(new Set());
      if (!online) {
        setEdge({ kind: "offline" });
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      setEdge({ kind: "loading" });
      const outcome = await suggestReactions(
        { text, locale: input.locale, limit: input.limit },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setEdge({ kind: "done", outcome });
      announce(outcome.ok ? `${outcome.results.length} reactions from the edge` : outcome.message);
    },
    [online, announce],
  );

  // The first example runs when the tab first opens, so the panel is never empty.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({ text: FIRST.text, locale: FIRST.locale, limit: 8 });
  }, [send]);
  useEffect(() => () => request.current?.abort(), []);

  // On device: the same engine as search, over the whole message. Free, offline, instant.
  const device = useMemo(() => {
    if (!engine || !sent) return undefined;
    const startedAt = performance.now();
    const { results } = engine.search(sent.text, {
      limit: sent.limit,
      locale: sent.locale,
      locales: [sent.locale],
      prefix: false,
    });
    return { results, ms: performance.now() - startedAt };
  }, [engine, sent]);

  const outcome = edge?.kind === "done" ? edge.outcome : undefined;
  const edgeResults = outcome?.ok ? outcome : undefined;
  const preview =
    edgeResults && edgeResults.results.length > 0 ? edgeResults.results : (device?.results ?? []);
  const previewFrom = edgeResults && edgeResults.results.length > 0 ? "edge" : "device";
  const label = (result: SearchResult) =>
    engine?.get(result.id)?.labels[sent?.locale ?? "en"] ?? engine?.get(result.id)?.labels.en ?? result.id;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send(draft);
    }
  };
  const toggle = (emojiId: string) =>
    setReacted((previous) => {
      const next = new Set(previous);
      if (!next.delete(emojiId)) next.add(emojiId);
      return next;
    });

  const snippets = useMemo(() => reactionSnippets(sent ?? draft, ENDPOINTS), [sent, draft]);
  const server = edgeResults?.serverTiming ?? [];
  const rows: TimingRow[] = [
    { label: "On device", ms: device?.ms, note: engine ? "–" : "loading…", tone: "device" },
    {
      label: "Edge round trip",
      ms: edgeResults?.ms,
      note:
        edge?.kind === "loading"
          ? "waiting"
          : edge?.kind === "offline"
            ? "offline"
            : outcome
              ? "failed"
              : "–",
    },
    ...server
      .filter((entry) => entry.name !== "total")
      .map((entry) => ({ label: `Server: ${entry.name}`, ms: entry.ms, nested: true })),
    ...(serverTotal(server) !== undefined
      ? [{ label: "Server: total", ms: serverTotal(server), nested: true }]
      : []),
  ];
  const over = draft.text.length > API_CHARS;

  return (
    <div className="pg-reactions">
      <div className="pg-split">
        <form className="pg-panel pg-composer" onSubmit={submit}>
          <header className="pg-panel-head">
            <label className="pg-label" htmlFor={`${id}-text`}>
              Message
            </label>
            <span className="pg-count" data-over={over || undefined}>
              {draft.text.length} / {API_CHARS}
            </span>
          </header>
          <textarea
            id={`${id}-text`}
            className="pg-textarea"
            value={draft.text}
            rows={4}
            maxLength={1000}
            placeholder="Paste a chat message…"
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            onKeyDown={onKeyDown}
          />
          {over && <p className="pg-note">The API reads the first {API_CHARS} characters.</p>}
          <div className="pg-controls">
            <label className="pg-field">
              <span className="pg-label">Locale</span>
              <select
                className="pg-select"
                value={draft.locale}
                onChange={(event) => setDraft({ ...draft, locale: event.target.value as Locale })}
              >
                {LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_NAMES[code]} · {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="pg-field">
              <span className="pg-label">Limit</span>
              <select
                className="pg-select"
                value={draft.limit}
                onChange={(event) => setDraft({ ...draft, limit: Number(event.target.value) })}
              >
                {LIMITS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="pg-button pg-button-primary"
              disabled={!draft.text.trim()}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              Suggest reactions
              <kbd className="pg-kbd pg-kbd-on-accent">{mac ? "⌘ ↵" : "Ctrl ↵"}</kbd>
            </button>
          </div>
          <div className="pg-examples pg-examples-stack">
            <span className="pg-label">Try</span>
            {REACTION_EXAMPLES.map((example) => (
              <button
                key={example.text}
                type="button"
                className="pg-chip"
                aria-pressed={sent?.text === example.text}
                onClick={() => {
                  const next = { ...draft, text: example.text, locale: example.locale };
                  setDraft(next);
                  void send(next);
                }}
              >
                {example.text}
              </button>
            ))}
          </div>
        </form>

        <div className="pg-stack">
          <section className="pg-panel pg-preview" aria-label="Preview">
            <header className="pg-panel-head">
              <h2 className="pg-label">Preview</h2>
              <span className="pg-count">{previewFrom === "edge" ? "from the edge" : "from the device"}</span>
            </header>
            <article className="pg-message">
              <span className="pg-avatar" aria-hidden="true">
                MC
              </span>
              <div className="pg-message-body">
                <p className="pg-message-meta">
                  <strong>Maya Chen</strong> <span>9:41 AM</span>
                </p>
                <p className="pg-message-text">{sent?.text ?? "…"}</p>
                <ul
                  className="pg-reaction-row"
                  aria-label="Suggested reactions"
                  aria-busy={edge?.kind === "loading"}
                >
                  {edge?.kind === "loading" && preview.length === 0
                    ? Array.from({ length: 4 }, (_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
                        <li key={i} className="pg-reaction pg-skeleton" aria-hidden="true" />
                      ))
                    : preview.slice(0, PREVIEW_COUNT).map((result) => (
                        <li key={result.id}>
                          <button
                            type="button"
                            className="pg-reaction"
                            aria-pressed={reacted.has(result.id)}
                            aria-label={`React with ${label(result)}`}
                            onClick={() => toggle(result.id)}
                          >
                            <span className="emoji">{result.emoji}</span>
                            <span className="pg-reaction-count">{reacted.has(result.id) ? 1 : ""}</span>
                          </button>
                        </li>
                      ))}
                </ul>
              </div>
            </article>
          </section>

          <div className="pg-compare">
            <ReactionList
              title="Edge"
              subtitle="POST /v1/suggest-reactions"
              results={edgeResults?.results}
              label={label}
              status={
                edge === undefined || edge.kind === "loading"
                  ? "Asking the edge…"
                  : edge.kind === "offline"
                    ? "You are offline. The device answers alone."
                    : !edge.outcome.ok
                      ? `${edge.outcome.message} The device answers alone.`
                      : edge.outcome.overLimit
                        ? "Over the monthly limit: dictionary results only."
                        : edge.outcome.results.length === 0
                          ? "The edge found no reaction for this message."
                          : undefined
              }
            />
            <ReactionList
              title="On device"
              subtitle="engine.search · offline"
              results={device?.results}
              label={label}
              status={
                !engine
                  ? "Loading the on-device dictionary…"
                  : device && device.results.length === 0
                    ? "No known phrase in this message. The edge reads the whole meaning."
                    : undefined
              }
            />
          </div>

          <section className="pg-panel" aria-label="Timing">
            <header className="pg-panel-head">
              <h2 className="pg-label">Timing</h2>
              <span className="pg-count">never cached: chat text is private</span>
            </header>
            <TimingBars rows={rows} label="Time per step for this message" />
          </section>
        </div>
      </div>

      <CodePanel title="Copy as code" samples={snippets} selected={codeTab} onSelect={onCodeTab} />
    </div>
  );
}

/** The ⌘ key exists on Apple keyboards only. The server render assumes a Mac. */
function useIsMac(): boolean {
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), []);
  return mac;
}

function ReactionList(props: {
  title: string;
  subtitle: string;
  results: SearchResult[] | undefined;
  label: (result: SearchResult) => string;
  status: string | undefined;
}) {
  return (
    <section className="pg-panel pg-reaction-list" aria-label={props.title}>
      <header className="pg-panel-head">
        <h2 className="pg-label">{props.title}</h2>
        <code className="pg-count">{props.subtitle}</code>
      </header>
      {props.status ? (
        <p className="pg-quiet pg-list-status" role="status">
          {props.status}
        </p>
      ) : (
        <ol className="pg-list">
          {(props.results ?? []).map((result) => (
            <li key={result.id}>
              <span className="emoji pg-list-emoji">{result.emoji}</span>
              <span className="pg-list-name">{props.label(result)}</span>
              <span className="pg-source" data-source={result.source}>
                {SOURCE_NAMES[result.source]}
              </span>
              <span className="pg-mono pg-list-score">{result.score.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
