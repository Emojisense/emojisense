import type { SearchResult } from "emojisense";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStageI18n } from "../../i18n/stage";
import { LOGO_VIEWBOX, LOGOS } from "../../lib/logos";
import { highlightAndPick, typeText, useSkinAutoplay } from "./autoplay";
import { optionId, ResultsOrStatus, Timing } from "./ResultList";
import type { SkinProps } from "./skins";
import { useQuerySearch } from "./useQuerySearch";

const TOAST_MS = 2200;

/** A launcher with one command, Search Emoji: type what you mean, Enter pastes the emoji. */
export default function LauncherSkin({ skin, engine, visible }: SkinProps) {
  const id = useId();
  const listId = `${id}-list`;
  const { t, messages } = useStageI18n();
  const words = messages.skins.raycast;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [pasted, setPasted] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);
  const toast = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { results, session } = useQuerySearch(engine, query, 7);
  const search = (next: string) => {
    setQuery(next);
    setActive(0);
  };

  useEffect(() => () => clearTimeout(toast.current), []);

  const paste = (result: SearchResult | undefined) => {
    if (!result) return;
    setPasted(result.emoji);
    clearTimeout(toast.current);
    toast.current = setTimeout(() => setPasted(undefined), TOAST_MS);
  };

  const latest = useRef(results);
  useLayoutEffect(() => {
    latest.current = results;
  });

  useSkinAutoplay({
    root: rootRef,
    visible,
    ready: engine !== undefined,
    async script(run) {
      if (!(await typeText(run, "", skin.query, search))) return;
      await highlightAndPick(run, skin.target, () => ({
        results: latest.current,
        setActive,
        pick: paste,
        press: setPressing,
      }));
    },
    finish: () => search(skin.query),
    reset: () => search(""),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;
    if (count > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      paste(results[active]);
    } else if (event.key === "Escape") {
      search("");
    }
  };

  const logo = LOGOS.raycast;

  return (
    <div className="stg-app stg-app-raycast" ref={rootRef}>
      <div className="stg-launcher">
        <div className="stg-launcher-search">
          <input
            type="text"
            value={query}
            placeholder={words.placeholder}
            aria-label={words.placeholder}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(listId, active) : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => search(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Timing session={session} />
        </div>
        <div className="stg-launcher-body">
          <p className="stg-launcher-section" aria-hidden="true">
            {query.trim() ? words.results : words.hint}
          </p>
          <ResultsOrStatus
            id={listId}
            engine={engine}
            ready={engine !== undefined}
            results={results}
            session={session}
            active={active}
            setActive={setActive}
            onPick={paste}
            pressing={pressing}
            action={
              <>
                {words.paste} <kbd>↵</kbd>
              </>
            }
          />
        </div>
        <div className="stg-launcher-bar" aria-hidden="true">
          <span className="stg-launcher-command">
            {logo.kind === "icon" && (
              <svg viewBox={logo.viewBox ?? LOGO_VIEWBOX} aria-hidden="true" focusable="false">
                <path d={logo.path} />
              </svg>
            )}
            {words.command}
          </span>
          <span className="stg-launcher-actions">
            {words.paste} <kbd>↵</kbd>
            <span className="stg-launcher-sep" />
            {words.actions} <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </div>
        <p className="stg-toast" role="status" data-shown={pasted ? "" : undefined}>
          {pasted ? t.t("pasted", { emoji: pasted }) : ""}
        </p>
      </div>
    </div>
  );
}
