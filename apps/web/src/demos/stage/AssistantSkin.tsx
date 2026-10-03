import type { SearchResult, SessionState } from "emojisense";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStageI18n } from "../../i18n/stage";
import { LOGO_VIEWBOX, LOGOS } from "../../lib/logos";
import { typeText, useSkinAutoplay, wait } from "./autoplay";
import type { SkinProps } from "./skins";
import { useQuerySearch } from "./useQuerySearch";

/** The MCP server's tools that the demo calls: a search for the model's words, or for the user's. */
type Tool = "search_emoji" | "emoji_for_text";

interface Exchange {
  id: number;
  ask: string;
  tool: Tool;
  argument: string;
  /** Undefined while the tool runs. */
  results?: SearchResult[];
}

const SHOWN = 6;
/** The tool call stays on screen a moment before its answer, as a real one would. */
const ANSWER_DELAY_MS = 650;

const settled = (session: SessionState | undefined, query: string): session is SessionState =>
  session !== undefined &&
  session.query === query &&
  session.status !== "loading" &&
  session.status !== "idle";

/** An AI assistant that calls the Emojisense MCP server's tools, answered by the real engine. */
export default function AssistantSkin({ skin, engine, visible }: SkinProps) {
  const id = useId();
  const { t, messages } = useStageI18n();
  const words = messages.skins.mcp;
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [query, setQuery] = useState("");
  const [pressing, setPressing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const { session } = useQuerySearch(engine, query, SHOWN);

  // The open tool call gets its answer once the search for its argument has settled.
  useEffect(() => {
    if (!settled(session, query)) return;
    const pending = exchanges.find((item) => !item.results && item.argument.trim() === query);
    if (!pending) return;
    const results = session.results.slice(0, SHOWN);
    const timer = setTimeout(() => {
      setExchanges((list) => list.map((item) => (item.id === pending.id ? { ...item, results } : item)));
    }, ANSWER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [session, query, exchanges]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the log grows.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [exchanges]);

  /** Shows the question and the tool call; the search answers it. */
  const ask = (text: string, tool: Tool, argument: string) => {
    const exchange: Exchange = { id: ++nextId.current, ask: text, tool, argument };
    setExchanges((list) => [...list.slice(-1), exchange]);
    setDraft("");
    setQuery(argument.trim());
  };

  const auto = useSkinAutoplay({
    root: rootRef,
    visible,
    ready: engine !== undefined,
    async script(run) {
      if (!(await typeText(run, "", words.ask, setDraft))) return;
      await wait(250);
      setPressing(true);
      await wait(170);
      setPressing(false);
      if (!run.cancelled) ask(words.ask, "search_emoji", skin.query);
    },
    finish: () => ask(words.ask, "search_emoji", skin.query),
    reset: () => {
      setDraft("");
      setExchanges([]);
      setQuery("");
    },
  });

  const logo = LOGOS.mcp;
  const reply = (results: SearchResult[]) => {
    const [first, second] = results;
    if (!first) return words.none;
    return second
      ? t.t("skins.mcp.reply", { emoji: first.emoji, second: second.emoji })
      : t.t("skins.mcp.replyOne", { emoji: first.emoji });
  };

  return (
    <div className="stg-app stg-app-mcp" ref={rootRef}>
      <div className="stg-assistant">
        <div className="stg-assistant-head">
          <span className="stg-assistant-name">{words.title}</span>
          <span className="stg-assistant-server">
            {logo.kind === "icon" && (
              <svg viewBox={logo.viewBox ?? LOGO_VIEWBOX} aria-hidden="true" focusable="false">
                <path d={logo.path} />
              </svg>
            )}
            {words.server}
          </span>
        </div>
        <div className="stg-assistant-log" ref={logRef} aria-live="polite">
          {exchanges.length === 0 && <p className="stg-assistant-empty">{words.empty}</p>}
          {exchanges.map((exchange) => (
            <div key={exchange.id} className="stg-exchange">
              <p className="stg-bubble">{exchange.ask}</p>
              <div className="stg-tool" data-done={exchange.results ? "" : undefined}>
                <p className="stg-tool-head">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z" />
                  </svg>
                  <code>{exchange.tool}</code>
                  <span className="stg-tool-state">
                    {exchange.results ? t.t("skins.mcp.done") : t.t("skins.mcp.calling")}
                  </span>
                </p>
                <pre className="stg-tool-args" dir="ltr">
                  {`{ "${exchange.tool === "search_emoji" ? "query" : "text"}": ${JSON.stringify(exchange.argument)} }`}
                </pre>
                {exchange.results && exchange.results.length > 0 && (
                  <p className="stg-tool-results">
                    {exchange.results.map((result) => (
                      <span key={result.id} className="emoji">
                        {result.emoji}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {exchange.results && <p className="stg-answer">{reply(exchange.results)}</p>}
            </div>
          ))}
        </div>
        <form
          className="stg-assistant-form"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text) ask(text, "emoji_for_text", text);
          }}
        >
          <label className="visually-hidden" htmlFor={`${id}-ask`}>
            {words.label}
          </label>
          <input
            id={`${id}-ask`}
            type="text"
            value={draft}
            placeholder={words.placeholder}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className={pressing ? "is-pressing" : undefined}
            disabled={draft.trim() === "" && auto !== "playing"}
          >
            {words.send}
          </button>
        </form>
      </div>
    </div>
  );
}
