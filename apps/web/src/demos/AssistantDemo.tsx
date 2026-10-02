import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDemoI18n } from "../i18n/demos";
import { fullEngine } from "../lib/engine-client";
import { ConfigPanel } from "./assistant/ConfigPanel";
import { AssistantMark, SendArrow } from "./assistant/icons";
import type { EmojiSuggestion } from "./assistant/mcp";
import { Reply } from "./assistant/Reply";
import { type Scenario, scenarios } from "./assistant/scenarios";
import { ToolCard } from "./assistant/ToolCard";
import { pause, prefersReducedMotion, useConversation } from "./assistant/useConversation";
import assistantCss from "./assistant.css?url";
import { useAutoplayControl } from "./autoplay-control";

const TYPE_MS = 24;
const NO_RESULTS: readonly EmojiSuggestion[] = [];

/**
 * A generic AI chat with Emojisense connected as an MCP tool. The conversation is scripted; every
 * tool result is computed live in the browser by the MCP server's own handlers on the real engine.
 */
export default function AssistantDemo() {
  const { t } = useDemoI18n();
  const SCENARIOS = useMemo(() => scenarios(t), [t]);
  const { turns, send, toggle, finish } = useConversation();
  const [draft, setDraft] = useState("");
  /** The autoplay types the first prompt, then its answer plays. */
  const [autoplayPhase, setAutoplayPhase] = useState<"off" | "typing" | "answering">("off");
  const chatRef = useRef<HTMLElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const started = useRef(false);
  const autoplay = useRef<AbortController>(undefined);

  const choose = useCallback(
    (scenario: Scenario) => {
      started.current = true;
      autoplay.current?.abort();
      setAutoplayPhase("off");
      setDraft("");
      pinned.current = true;
      send(scenario);
    },
    [send],
  );

  /** "Stop demo": the typing stops, and an answer in progress shows in full at once. */
  const stopAutoplay = useCallback(() => {
    autoplay.current?.abort();
    setAutoplayPhase("off");
    setDraft("");
    finish();
  }, [finish]);

  // Start loading the full engine now (shared with the other demos), so the first call is quick.
  useEffect(() => {
    fullEngine().catch(() => {});
  }, []);

  // Play the first prompt once the chat is on screen: typed into the composer, then sent.
  useEffect(() => {
    const chat = chatRef.current;
    const first = SCENARIOS[0];
    if (!chat || !first) return;
    if (prefersReducedMotion()) {
      if (!started.current) choose(first);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        if (started.current) return;
        started.current = true;
        const controller = new AbortController();
        autoplay.current = controller;
        setAutoplayPhase("typing");
        void (async () => {
          const chars = [...first.prompt];
          await pause(500, controller.signal);
          for (let i = 1; i <= chars.length && !controller.signal.aborted; i++) {
            setDraft(chars.slice(0, i).join(""));
            await pause(TYPE_MS, controller.signal);
          }
          await pause(420, controller.signal);
          if (controller.signal.aborted) return;
          setDraft("");
          send(first);
          setAutoplayPhase("answering");
        })();
      },
      { threshold: 0.4 },
    );
    observer.observe(chat);
    return () => {
      observer.disconnect();
      autoplay.current?.abort();
    };
  }, [choose, send, SCENARIOS]);

  // Keep the newest words in view while the visitor has not scrolled up.
  useEffect(() => {
    const log = logRef.current;
    const thread = threadRef.current;
    if (!log || !thread) return;
    const follow = () => {
      if (pinned.current) log.scrollTop = log.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    observer.observe(thread);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const log = logRef.current;
    if (log) pinned.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  };

  const current = turns.at(-1);
  const busy = current !== undefined && current.phase !== "done" && current.phase !== "failed";
  useAutoplayControl(autoplayPhase === "typing" || (autoplayPhase === "answering" && busy), stopAutoplay);
  const activeTool =
    current && (current.phase === "calling" || current.phase === "answered")
      ? current.scenario.call.name
      : undefined;

  return (
    <div className="assistant">
      <link rel="stylesheet" href={assistantCss} precedence="demo" />
      <section className="assistant-chat" ref={chatRef} aria-label={t.t("assistant.chat")}>
        <header className="assistant-head">
          <span className="assistant-avatar">
            <AssistantMark />
          </span>
          <span className="assistant-title">
            <strong>{t.t("assistant.name")}</strong>
            <span>{t.t("assistant.newChat")}</span>
          </span>
          <span className="assistant-connected" title={t.t("assistant.connected")}>
            <span className="assistant-live" aria-hidden="true" />
            emojisense
            <span className="assistant-connected-count">{t.t("assistant.toolCount")}</span>
          </span>
        </header>

        <div className="assistant-log" ref={logRef} onScroll={onScroll} role="log" aria-busy={busy}>
          <div className="assistant-thread" ref={threadRef}>
            {turns.length === 0 && (
              <div className="assistant-empty">
                <span className="assistant-avatar assistant-avatar-lg">
                  <AssistantMark />
                </span>
                <p>{t.t("assistant.emptyTitle")}</p>
                <span>{t.t("assistant.emptyBody")}</span>
              </div>
            )}
            {turns.map((turn) => (
              <article key={turn.key} className="assistant-turn" aria-label={turn.scenario.prompt}>
                <div className="assistant-user">
                  <p>{turn.scenario.prompt}</p>
                </div>
                <div className="assistant-bot">
                  <span className="assistant-avatar assistant-avatar-sm">
                    <AssistantMark />
                  </span>
                  <div className="assistant-bot-body">
                    {turn.phase === "sent" ? (
                      <span className="assistant-typing" role="img" aria-label={t.t("assistant.thinking")}>
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <ToolCard turn={turn} onToggle={() => toggle(turn.key)} />
                    )}
                    {turn.reply && (
                      <Reply
                        blocks={turn.reply}
                        shown={turn.shown}
                        streaming={turn.phase === "streaming"}
                        results={turn.run?.structured.results ?? NO_RESULTS}
                      />
                    )}
                    {turn.phase === "failed" && (
                      <div className="assistant-reply">
                        <p>{t.t("assistant.failed")}</p>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="assistant-dock">
          <fieldset className="assistant-prompts">
            <legend className="visually-hidden">{t.t("assistant.prompts")}</legend>
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className="assistant-chip"
                data-active={busy && current?.scenario.id === scenario.id}
                onClick={() => choose(scenario)}
              >
                {scenario.prompt}
              </button>
            ))}
          </fieldset>
          <div className="assistant-composer" aria-hidden="true">
            <span className={draft ? "assistant-draft" : "assistant-placeholder"}>
              {draft || t.t("assistant.placeholder")}
              {draft && <span className="assistant-caret" />}
            </span>
            <span className="assistant-send" data-ready={draft !== ""}>
              <SendArrow />
            </span>
          </div>
          <p className="assistant-note">{t.t("assistant.note")}</p>
        </div>
      </section>

      <ConfigPanel activeTool={activeTool} />
    </div>
  );
}
