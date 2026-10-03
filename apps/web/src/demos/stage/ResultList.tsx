import type { AliasEngine, SearchResult, SessionState } from "emojisense";
import { type ReactNode, useEffect, useRef } from "react";
import { useStageI18n } from "../../i18n/stage";
import { labelOf } from "../../lib/engine-client";
import { hintFor } from "../chat/shortcodes";
import { meaningStage, usePromoted } from "../meaning";

interface ResultListProps {
  id: string;
  engine: AliasEngine | undefined;
  results: SearchResult[];
  session: SessionState | undefined;
  active: number;
  setActive: (index: number) => void;
  onPick: (result: SearchResult) => void;
  /** Autoplay presses the highlighted row. */
  pressing: boolean;
  /** The row's main text; the emoji's name by default. */
  primary?: (result: SearchResult) => ReactNode;
  /** Shown at the end of the highlighted row, e.g. "↵ Paste". */
  action?: ReactNode;
}

export const optionId = (listId: string, index: number) => `${listId}-${index}`;

function formatMs(ms: number, lang: string): string {
  const digits = ms < 1 ? 2 : ms < 10 ? 1 : 0;
  return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    ms,
  );
}

/** Where the list on screen comes from and how long it took, e.g. "0.42 ms on device". */
export function Timing({ session }: { session: SessionState | undefined }) {
  const { t, lang } = useStageI18n();
  const stage = meaningStage(session?.status);
  if (!session || !stage) return null;
  const text =
    stage === "pending"
      ? t.t("meaningPending")
      : stage === "meaning" && session.semanticMs !== undefined
        ? t.t("meaning", { ms: formatMs(session.semanticMs, lang) })
        : t.t("onDevice", { ms: formatMs(session.aliasMs, lang) });
  return (
    <span className="stg-time meaning-badge" data-stage={stage}>
      {text}
    </span>
  );
}

/**
 * Ranked emoji as a listbox. Keys stay in the field that owns the list (aria-activedescendant), so
 * the rows only take the pointer.
 */
export function ResultList(props: ResultListProps) {
  const { id, engine, results, session, active, setActive, onPick, pressing, primary, action } = props;
  const { t } = useStageI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const promoted = usePromoted(
    session?.query ?? "",
    results.map((r) => r.id),
  );

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

  return (
    <div className="stg-list" id={id} role="listbox" aria-label={t.t("results")} ref={listRef}>
      {results.map((result, index) => {
        const hint = hintFor(engine, result);
        const classes = ["stg-opt"];
        if (index === active && pressing) classes.push("is-pressing");
        if (promoted.has(result.id)) classes.push("meaning-promoted");
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys go to the field (aria-activedescendant).
          <div
            key={result.id}
            id={optionId(id, index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className={classes.join(" ")}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => index !== active && setActive(index)}
            onClick={() => onPick(result)}
          >
            <span className="emoji stg-opt-emoji">{result.emoji}</span>
            <span className="stg-opt-main">{primary ? primary(result) : labelOf(engine, result.id)}</span>
            {hint && (
              <span className="stg-opt-hint">
                {hint.kind === "meaning" ? t.t("byMeaning") : <q>{hint.text}</q>}
              </span>
            )}
            {action && index === active && <span className="stg-opt-action">{action}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The list, or a line that says why there is none yet. */
export function ResultsOrStatus(props: ResultListProps & { ready: boolean }) {
  const { t } = useStageI18n();
  if (props.results.length > 0) return <ResultList {...props} />;
  const status = !props.ready
    ? t.t("loading")
    : props.session?.status === "loading"
      ? t.t("searching")
      : props.session
        ? t.t("noResults")
        : undefined;
  return status ? <p className="stg-status">{status}</p> : null;
}
