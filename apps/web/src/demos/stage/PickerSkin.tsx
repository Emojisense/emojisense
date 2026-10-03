import type { SearchResult } from "emojisense";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStageI18n } from "../../i18n/stage";
import { highlightAndPick, typeText, useSkinAutoplay, wait } from "./autoplay";
import { optionId, ResultsOrStatus, Timing } from "./ResultList";
import type { SkinProps } from "./skins";
import { useQuerySearch } from "./useQuerySearch";

const isShortcut = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) && event.shiftKey && (event.code === "Space" || event.key === " ");

/** A web mail window and the extension's picker, opened on any text field by a shortcut. */
export default function PickerSkin({ skin, engine, visible }: SkinProps) {
  const id = useId();
  const listId = `${id}-list`;
  const { t, messages } = useStageI18n();
  const words = messages.skins.chrome;
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [keysDown, setKeysDown] = useState(false);
  const [mac, setMac] = useState(false);
  const caret = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { results, session } = useQuerySearch(engine, open ? query : "");
  const search = (next: string) => {
    setQuery(next);
    setActive(0);
  };

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), []);

  const insert = (emoji: string) => {
    const at = Math.min(caret.current, body.length);
    const next = `${body.slice(0, at)}${emoji}${body.slice(at)}`;
    caret.current = at + emoji.length;
    setBody(next);
    setOpen(false);
    setQuery("");
    return next;
  };

  const latest = useRef({ results, insert });
  useLayoutEffect(() => {
    latest.current = { results, insert };
  });

  const openPicker = () => {
    caret.current = bodyRef.current?.selectionStart ?? body.length;
    setOpen(true);
  };

  useEffect(() => {
    if (
      open &&
      document.activeElement !== searchRef.current &&
      rootRef.current?.contains(document.activeElement)
    ) {
      searchRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    bodyRef.current?.focus();
  };

  const auto = useSkinAutoplay({
    root: rootRef,
    visible,
    ready: engine !== undefined,
    async script(run) {
      const writeBody = (value: string) => {
        caret.current = value.length;
        setBody(value);
      };
      if (!(await typeText(run, "", `${words.line} `, writeBody))) return;
      await wait(350);
      setKeysDown(true);
      await wait(420);
      setKeysDown(false);
      if (run.cancelled) return;
      setOpen(true);
      await wait(300);
      if (!(await typeText(run, "", skin.query, search))) return;
      await highlightAndPick(run, skin.target, () => ({
        results: latest.current.results,
        setActive,
        pick: (result) => latest.current.insert(result.emoji),
        press: setPressing,
      }));
    },
    finish: () => {
      const text = `${words.line} ${skin.emoji}`;
      caret.current = text.length;
      setBody(text);
      setOpen(false);
    },
    reset: () => {
      setBody("");
      setQuery("");
      setOpen(false);
      setKeysDown(false);
    },
  });

  const pick = (result: SearchResult | undefined) => {
    if (!result) return;
    insert(result.emoji);
    requestAnimationFrame(() => {
      const field = bodyRef.current;
      field?.focus();
      field?.setSelectionRange(caret.current, caret.current);
    });
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;
    if (count > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === "Escape" || isShortcut(event)) {
      event.preventDefault();
      close();
    }
  };

  const keys = mac ? ["⌘", "⇧", "Space"] : ["Ctrl", "Shift", "Space"];

  return (
    <div className="stg-app stg-app-chrome" ref={rootRef}>
      <div className="stg-browser">
        <div className="stg-browser-bar" aria-hidden="true">
          <span className="stg-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="stg-url">{words.url}</span>
        </div>
        <div className="stg-mail">
          <p className="stg-mail-title">{words.window}</p>
          <p className="stg-mail-row">
            <span>{words.to}</span>
            {words.toValue}
          </p>
          <p className="stg-mail-row">
            <span>{words.subject}</span>
            {words.subjectValue}
          </p>
          <label className="visually-hidden" htmlFor={`${id}-body`}>
            {words.label}
          </label>
          <div className="stg-mail-body">
            <textarea
              id={`${id}-body`}
              ref={bodyRef}
              className="stg-input"
              value={body}
              placeholder={t.t("pickerPlaceholder", { keys: keys.join(" ") })}
              spellCheck={false}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (!isShortcut(event)) return;
                event.preventDefault();
                openPicker();
              }}
            />
            <div className="stg-mirror" aria-hidden="true">
              {body}
              {auto === "playing" && !open && <span key={body.length} className="stg-caret" />}
              {"​"}
            </div>
          </div>
          <p className="stg-keys" data-down={keysDown || undefined}>
            <button type="button" className="stg-keys-button" onClick={openPicker}>
              <span className="visually-hidden">{words.open}</span>
              <span aria-hidden="true">
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </button>
          </p>
        </div>
        {open && (
          <div className="stg-picker" role="dialog" aria-label={words.picker}>
            <div className="stg-picker-search">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={words.search}
                aria-label={words.search}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={results.length > 0 ? optionId(listId, active) : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => search(event.target.value)}
                onKeyDown={onSearchKey}
              />
              <Timing session={session} />
            </div>
            <ResultsOrStatus
              id={listId}
              engine={engine}
              ready={engine !== undefined}
              results={results}
              session={session}
              active={active}
              setActive={setActive}
              onPick={pick}
              pressing={pressing}
              action={<kbd>↵</kbd>}
            />
          </div>
        )}
      </div>
    </div>
  );
}
