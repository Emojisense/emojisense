import { type CSSProperties, useId, useState } from "react";
import { type DemoMessages, useDemoI18n } from "../../i18n/demos";
import type { Translator } from "../../i18n/translate";
import { Chevron, ToolIcon } from "./icons";
import { highlightJson, inlineJson } from "./json";
import { type EmojiSuggestion, SERVER_NAME } from "./mcp";
import type { Turn } from "./useConversation";

/** The one argument a reader cares about: the query or the text. */
function preview(turn: Turn): string {
  const { call } = turn.scenario;
  return `“${call.name === "search_emoji" ? call.args.query : call.args.text}”`;
}

function formatMs(ms: number, lang: string): string {
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
      value,
    );
  if (ms < 0.1) return `< ${number(0.1, 1)} ms`;
  return `${number(ms, ms < 10 ? 1 : 0)} ms`;
}

function why(result: EmojiSuggestion, t: Translator<DemoMessages>): string {
  if (result.source === "default") return t.t("assistant.tool.generic");
  const reason = result.window ?? result.match;
  return reason ? t.t("assistant.tool.matched", { reason }) : "";
}

/** A tool call as a chat client shows it: request, live response, and how long it took. */
export function ToolCard({ turn, onToggle }: { turn: Turn; onToggle: () => void }) {
  const [view, setView] = useState<"emoji" | "json">("emoji");
  const { t, lang } = useDemoI18n();
  const bodyId = useId();
  const { run, phase, open } = turn;
  const { call } = turn.scenario;
  const failed = phase === "failed";
  const results = run?.structured.results ?? [];
  const state = failed ? "failed" : run ? "done" : "running";

  return (
    <div className="assistant-tool" data-state={state} data-open={open}>
      <button
        type="button"
        className="assistant-tool-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="assistant-tool-icon">
          <ToolIcon name={call.name} />
        </span>
        <span className="assistant-tool-name">
          <span className="assistant-tool-verb">
            {failed
              ? t.t("assistant.tool.failed")
              : run
                ? t.t("assistant.tool.used")
                : t.t("assistant.tool.calling")}
          </span>{" "}
          <code>{call.name}</code>
        </span>
        <span className="assistant-tool-preview">{preview(turn)}</span>
        {run && results.length > 0 && (
          <span className="assistant-tool-strip">
            <span className="visually-hidden">{t.plural("assistant.tool.results", results.length)}</span>
            {results.slice(0, 6).map((r) => (
              <span key={r.id} className="emoji" title={r.label}>
                {r.emoji}
              </span>
            ))}
          </span>
        )}
        <span className="assistant-tool-meta">
          {run ? (
            <span title={t.t("assistant.tool.measured")}>{formatMs(run.ms, lang)}</span>
          ) : failed ? (
            t.t("assistant.tool.error")
          ) : (
            <span className="assistant-spinner" role="img" aria-label={t.t("assistant.tool.running")} />
          )}
        </span>
        <Chevron />
      </button>

      <div className="assistant-tool-body" id={bodyId} inert={!open}>
        <div className="assistant-tool-inner">
          <div className="assistant-tool-section">
            <div className="assistant-tool-row">
              <span className="assistant-tool-label">{t.t("assistant.tool.request")}</span>
              <span className="assistant-tool-server">{SERVER_NAME}</span>
            </div>
            <code className="assistant-tool-args">{highlightJson(inlineJson(call.args))}</code>
          </div>

          <div className="assistant-tool-section">
            <div className="assistant-tool-row">
              <span className="assistant-tool-label">{t.t("assistant.tool.response")}</span>
              {run && (
                <fieldset className="assistant-seg" aria-label={t.t("assistant.tool.view")}>
                  {(["emoji", "json"] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                      {v === "emoji" ? t.t("assistant.tool.emoji") : "JSON"}
                    </button>
                  ))}
                </fieldset>
              )}
            </div>
            {failed ? (
              <p className="assistant-tool-error">{t.t("assistant.tool.loadFailed")}</p>
            ) : !run ? (
              <div className="assistant-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            ) : view === "json" ? (
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
              <pre className="assistant-tool-json" tabIndex={0}>
                <code>{highlightJson(JSON.stringify(run.structured, null, 2))}</code>
              </pre>
            ) : results.length === 0 ? (
              <p className="assistant-tool-error">{t.t("assistant.tool.none")}</p>
            ) : (
              <ul className="assistant-results">
                {results.map((r, i) => (
                  <li key={r.id} title={why(r, t)} style={{ "--i": i } as CSSProperties}>
                    <span className="emoji" aria-hidden="true">
                      {r.emoji}
                    </span>
                    <span>{r.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
