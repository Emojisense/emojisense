import { useCallback, useEffect, useRef, useState } from "react";
import { fullEngine } from "../lib/engine-client";
import { ConfigPanel } from "./assistant/ConfigPanel";
import { AssistantMark, SendArrow } from "./assistant/icons";
import type { EmojiSuggestion } from "./assistant/mcp";
import { Reply } from "./assistant/Reply";
import { SCENARIOS, type Scenario } from "./assistant/scenarios";
import { ToolCard } from "./assistant/ToolCard";
import { pause, prefersReducedMotion, useConversation } from "./assistant/useConversation";
import "./assistant.css";

const TYPE_MS = 24;
const NO_RESULTS: readonly EmojiSuggestion[] = [];

/**
 * A generic AI chat with Emojisense connected as an MCP tool. The conversation is scripted; every
 * tool result is computed live in the browser by the MCP server's own handlers on the real engine.
 */
export default function AssistantDemo() {
  const { turns, send, toggle } = useConversation();
  const [draft, setDraft] = useState("");
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
      setDraft("");
      pinned.current = true;
      send(scenario);
    },
    [send],
  );

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
        })();
      },
      { threshold: 0.4 },
    );
    observer.observe(chat);
    return () => {
      observer.disconnect();
      autoplay.current?.abort();
    };
  }, [choose, send]);

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
  const activeTool =
    current && (current.phase === "calling" || current.phase === "answered")
      ? current.scenario.call.name
      : undefined;

  return (
    <div className="assistant">
      <section className="assistant-chat" ref={chatRef} aria-label="Assistant chat">
        <header className="assistant-head">
          <span className="assistant-avatar">
            <AssistantMark />
          </span>
          <span className="assistant-title">
            <strong>Assistant</strong>
            <span>New chat</span>
          </span>
          <span className="assistant-connected" title="MCP server connected">
            <span className="assistant-live" aria-hidden="true" />
            emojisense
            <span className="assistant-connected-count">3 tools</span>
          </span>
        </header>

        <div className="assistant-log" ref={logRef} onScroll={onScroll} role="log" aria-busy={busy}>
          <div className="assistant-thread" ref={threadRef}>
            {turns.length === 0 && (
              <div className="assistant-empty">
                <span className="assistant-avatar assistant-avatar-lg">
                  <AssistantMark />
                </span>
                <p>What should we write?</p>
                <span>Emojisense is connected, so the emoji come from a real search.</span>
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
                      <span className="assistant-typing" role="img" aria-label="Thinking">
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
                        <p>
                          The emoji tool did not answer, so I can't pick emoji right now. Try again in a
                          moment.
                        </p>
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
            <legend className="visually-hidden">Example prompts</legend>
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
              {draft || "Pick a prompt to run it"}
              {draft && <span className="assistant-caret" />}
            </span>
            <span className="assistant-send" data-ready={draft !== ""}>
              <SendArrow />
            </span>
          </div>
          <p className="assistant-note">Scripted conversation · live tool results</p>
        </div>
      </section>

      <ConfigPanel activeTool={activeTool} />
    </div>
  );
}
