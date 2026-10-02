import type { AliasEngine, SearchResult } from "emojisense";
import { type ChangeEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef } from "react";
import type { EngineState } from "../../lib/engine-client";
import { AtIcon, FormatIcon, PlusIcon, SendIcon, SmileIcon } from "./icons";
import { expandClosedCode, hintFor, shortcodeFor } from "./shortcodes";
import type { EmojiAutocomplete } from "./useEmojiAutocomplete";

interface ComposerProps {
  ac: EmojiAutocomplete;
  engine: AliasEngine | undefined;
  ready: EngineState["ready"];
  channel: string;
  onSend: () => void;
  /** Autoplay is typing: draw a caret, since the textarea is not focused. */
  ghostCaret: boolean;
  /** Autoplay presses a key: "option" picks the highlighted row, "send" sends. */
  pressing: "option" | "send" | undefined;
}

function formatMs(ms: number): string {
  return ms < 1 ? ms.toFixed(2) : ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

/** `:go` + `goat` → the typed part of the code in full ink, the rest muted. */
function Code({ code, query }: { code: string; query: string }) {
  const typed = query.toLowerCase().trim().replace(/\s+/g, "_");
  const match = typed && code.startsWith(typed) ? typed.length : 0;
  return (
    <span className="chat-opt-code">
      :<b>{code.slice(0, match)}</b>
      {code.slice(match)}:
    </span>
  );
}

export function Composer({ ac, engine, ready, channel, onSend, ghostCaret, pressing }: ComposerProps) {
  const id = useId();
  const listId = `${id}-emoji`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { trigger, results, session, active } = ac;
  const searching = session?.status === "loading";
  const open = trigger !== undefined && (results.length > 0 || ready === "loading" || searching);

  useLayoutEffect(() => {
    const caret = ac.pendingCaret.current;
    const textarea = textareaRef.current;
    if (caret === null || !textarea) return;
    ac.pendingCaret.current = null;
    if (document.activeElement === textarea) textarea.setSelectionRange(caret, caret);
  });

  // Keep the highlighted row visible without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[active] as HTMLElement | undefined;
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 4;
    }
  }, [active]);

  const pick = (result: SearchResult | undefined) => {
    if (result) ac.pick(result.emoji);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target;
    const typedColon = (event.nativeEvent as InputEvent).data === ":";
    const expanded = typedColon ? expandClosedCode(engine, value, selectionStart) : undefined;
    if (expanded) {
      ac.edit(expanded.value, expanded.caret);
      ac.pendingCaret.current = expanded.caret;
    } else {
      ac.edit(value, selectionStart);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (open && results.length > 0) {
      const count = results.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        ac.setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(results[active]);
        return;
      }
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      ac.dismiss();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const activeId = open && results.length > 0 ? `${listId}-${active}` : undefined;
  const timing = session
    ? [
        `${formatMs(session.aliasMs)} ms on-device`,
        session.status === "fused" && session.semanticMs !== undefined
          ? `meaning ${formatMs(session.semanticMs)} ms`
          : searching
            ? "meaning…"
            : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div className="chat-compose">
      {open && (
        <div className="chat-pop">
          <div className="chat-pop-head">
            <span className="chat-pop-title">
              Emoji matching <b>:{trigger.query}</b>
            </span>
            {timing && <span className="chat-pop-time">{timing}</span>}
          </div>
          {results.length > 0 ? (
            <div className="chat-pop-list" id={listId} role="listbox" aria-label="Emoji" ref={listRef}>
              {results.map((r, i) => {
                const hint = hintFor(engine, r);
                return (
                  // Keys go to the textarea (aria-activedescendant), so options only need the mouse.
                  // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
                  <div
                    key={r.id}
                    id={`${listId}-${i}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    className={`chat-opt${i === active && pressing === "option" ? " is-pressing" : ""}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => i !== active && ac.setActive(i)}
                    onClick={() => pick(r)}
                  >
                    <span className="emoji chat-opt-emoji">{r.emoji}</span>
                    <Code code={shortcodeFor(engine, r)} query={trigger.query} />
                    {hint && (
                      <span className="chat-opt-hint">
                        {hint.kind === "meaning" ? "by meaning" : <q>{hint.text}</q>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="chat-pop-status">
              {ready === "loading" ? "Loading emoji…" : "Searching by meaning…"}
            </p>
          )}
          <p className="chat-pop-foot" aria-hidden="true">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> select
            </span>
            <span>
              <kbd>esc</kbd> dismiss
            </span>
          </p>
        </div>
      )}

      <div className={`chat-composer${ghostCaret ? " is-active" : ""}`}>
        <div className="chat-field">
          <label className="visually-hidden" htmlFor={`${id}-input`}>
            Message #{channel}
          </label>
          <textarea
            id={`${id}-input`}
            ref={textareaRef}
            className="chat-input"
            rows={1}
            value={ac.value}
            placeholder={`Message #${channel}`}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeId}
            aria-describedby={`${id}-hint`}
            onChange={onChange}
            onSelect={(event) => ac.edit(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => ac.dismiss()}
          />
          <div className="chat-mirror" aria-hidden="true">
            {ac.value}
            {ghostCaret && <span key={ac.value.length} className="chat-caret" />}
            {"\u200b"}
          </div>
        </div>
        <div className="chat-toolbar">
          <span className="chat-tools" aria-hidden="true">
            <PlusIcon />
            <FormatIcon />
            <SmileIcon />
            <AtIcon />
          </span>
          <span className="chat-compose-hint" id={`${id}-hint`}>
            Type <kbd>:</kbd> and 2 letters for emoji
          </span>
          <button
            type="button"
            className={`chat-send${pressing === "send" ? " is-pressing" : ""}`}
            aria-label="Send message"
            disabled={ac.value.trim() === ""}
            onClick={onSend}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
