import { type CSSProperties, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Messages } from "../i18n/catalogs";
import { horizontalStep, useTranslator } from "../i18n/react";
import type { CalendarItem, DateWindow, LensOption, LensQuery, LensResult } from "../lib/culture";

interface Props {
  queries: LensQuery[];
  calendar: CalendarItem[];
  /** Build day, "YYYY-MM-DD". Replaced by the visitor's own day after hydration. */
  today: string;
  messages: Messages["culture"]["lens"];
  /** Intl tag of the page. */
  lang: string;
  /** Language of the example searches when it differs from the page's ("en"). */
  queryLang?: string | undefined;
}

const DAY_MS = 86_400_000;
/** Canonical results after the top answer: enough to show the list goes on. */
const MAX_REST = 3;

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const nextWindow = (windows: DateWindow[] | undefined, day: string) => windows?.find((w) => w.to >= day);
const isLive = (w: DateWindow | undefined, day: string) => w !== undefined && w.from <= day && day <= w.to;

/** "tomorrow", "in 5 days", "in 3 weeks", "in 2 months", in the page's language. */
function untilLabel(days: number, relative: Intl.RelativeTimeFormat): string {
  if (days <= 1) return relative.format(Math.max(days, 0), "day");
  if (days < 14) return relative.format(days, "day");
  if (days < 63) return relative.format(Math.round(days / 7), "week");
  return relative.format(Math.round(days / 30), "month");
}

/** "Today" shows whichever seasonal option is live on the visitor's day, else the lasting answer. */
function resolve(lens: LensQuery, option: LensOption, day: string): { key: string; result: LensResult } {
  if (lens.dimension !== "when" || option.id !== "today") return { key: option.id, result: option.result };
  const live = lens.options.find((o) => o.windows?.some((w) => isLive(w, day)));
  return live ? { key: live.id, result: live.result } : { key: option.id, result: option.result };
}

/**
 * Search examples read through culture, region and date, plus what is relevant on the calendar.
 * Its styles (culture-lens.css) are linked by Culture.astro, so they do not block the first paint.
 */
export function CultureLens({ queries, calendar, today: buildDay, messages, lang, queryLang }: Props) {
  const t = useTranslator(messages, lang);
  const [queryIndex, setQueryIndex] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [cultureOn, setCultureOn] = useState(true);
  const [today, setToday] = useState(buildDay);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const lensRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", timeZone: "UTC" }),
    [lang],
  );
  const relative = useMemo(() => new Intl.RelativeTimeFormat(lang, { numeric: "auto" }), [lang]);
  const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

  useEffect(() => setToday(localDay(new Date())), []);

  const lens = queries[queryIndex] ?? queries[0];
  if (!lens) return null;
  const option = lens.options.find((o) => o.id === picked[lens.query]) ?? lens.options[0];
  if (!option) return null;
  const { key: resultKey, result } = resolve(lens, option, today);

  const [top, ...others] = result.ranked;
  // Cultural tiles stay mounted while switched off, so their group can fold away smoothly.
  const added = others.filter((r) => r.source === "culture");
  const groupOpen = cultureOn && added.length > 0;
  const rest = (
    cultureOn ? others.filter((r) => r.source === "canonical").map((r) => r.emoji) : lens.canonical.slice(1)
  ).slice(0, MAX_REST);
  const shownNotes = cultureOn ? result.notes : [];

  const selectQuery = (index: number) => setQueryIndex(index);
  const selectOption = (query: string, optionId: string) => setPicked((p) => ({ ...p, [query]: optionId }));

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = queries.length - 1;
    const step = horizontalStep(event);
    const target: Record<string, number> = { Home: 0, End: last };
    const next = step === 0 ? target[event.key] : (queryIndex + step + queries.length) % queries.length;
    if (next === undefined) return;
    event.preventDefault();
    selectQuery(next);
    tabs.current[next]?.focus();
  };

  const openFromCalendar = (entryId: string) => {
    const index = queries.findIndex((q) => q.options.some((o) => o.id === `when:${entryId}`));
    const query = queries[index];
    if (!query) return;
    setQueryIndex(index);
    selectOption(query.query, `when:${entryId}`);
    setCultureOn(true);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    lensRef.current?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  };

  const emptyNote =
    lens.dimension === "when" && option.id === "today"
      ? t.t("nothingSeasonal", { day: formatDay(today), query: lens.query })
      : t.t("noAdditions");

  const calendarRows = calendar
    .map((item) => ({ item, window: nextWindow(item.windows, today) }))
    .filter((row): row is { item: CalendarItem; window: DateWindow } => row.window !== undefined)
    .sort((a, b) => Number(isLive(b.window, today)) - Number(isLive(a.window, today)));
  const linked = new Set(queries.flatMap((q) => q.options.map((o) => o.id)));

  return (
    <div className="culture">
      <div className="culture-lens" ref={lensRef}>
        <div className="culture-tabs" role="tablist" aria-label={t.t("tabs")} onKeyDown={onTabKeyDown}>
          {queries.map((q, i) => (
            <button
              key={q.query}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`${id}-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={i === queryIndex}
              aria-controls={`${id}-panel`}
              tabIndex={i === queryIndex ? 0 : -1}
              className="culture-tab"
              lang={queryLang}
              onClick={() => selectQuery(i)}
            >
              {q.query}
            </button>
          ))}
        </div>

        <div
          className="culture-panel"
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${queryIndex}`}
        >
          <div className="culture-field">
            <svg className="culture-field-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span className="culture-query" lang={queryLang}>
              {lens.query}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={cultureOn}
              className="culture-switch"
              onClick={() => setCultureOn((on) => !on)}
            >
              <span className="culture-switch-track" aria-hidden="true">
                <span className="culture-switch-thumb" />
              </span>
              <span className="culture-switch-label">{t.t("switch")}</span>
            </button>
          </div>

          <div
            className="culture-results"
            data-open={groupOpen}
            style={{ "--n": added.length } as CSSProperties}
          >
            <ol className="culture-tiles" aria-label={t.t("resultsFor", { query: lens.query })}>
              {top && (
                <li key={`${lens.query}-top`} className="culture-item culture-top">
                  <span className="culture-box emoji">{top.emoji}</span>
                  <span className="culture-cap">{t.t("topAnswer")}</span>
                </li>
              )}
              <li className="culture-item culture-group" aria-hidden={!groupOpen}>
                <span className="visually-hidden">{t.t("addedByCulture")}</span>
                <span className="culture-group-tiles">
                  {added.map((a, i) => (
                    <span
                      key={`${lens.query}-${resultKey}-${a.emoji}`}
                      className="culture-box culture-added emoji"
                      style={{ "--i": i } as CSSProperties}
                    >
                      {a.emoji}
                    </span>
                  ))}
                </span>
              </li>
              {rest.map((emoji) => (
                <li key={`${lens.query}-${emoji}`} className="culture-item culture-rest">
                  <span className="culture-box emoji">{emoji}</span>
                </li>
              ))}
            </ol>
            <span className="culture-cap culture-brace" aria-hidden="true">
              {t.t("switch")}
            </span>
          </div>

          <div className="culture-why" aria-live="polite">
            {!cultureOn ? (
              <p className="culture-why-empty">{t.t("off")}</p>
            ) : shownNotes.length > 0 ? (
              <ul>
                {shownNotes.map((note) => (
                  <li key={`${resultKey}-${note.id}`}>
                    <span className="culture-why-emoji emoji" aria-hidden="true">
                      {note.emoji.join("")}
                    </span>
                    <span className="culture-why-text">
                      <strong lang={note.lang}>{note.context}</strong>
                      <small>
                        {note.scope} · {note.provenance}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="culture-why-empty">{emptyNote}</p>
            )}
          </div>

          <div className="culture-context">
            {lens.dimension === null ? (
              <p className="culture-context-note">{t.t("sameEverywhere")}</p>
            ) : (
              <>
                <span className="culture-context-label" aria-hidden="true">
                  {lens.dimension === "where" ? t.t("where") : t.t("when")}
                </span>
                <fieldset className="culture-chips">
                  <legend className="visually-hidden">
                    {lens.dimension === "where" ? t.t("whereLegend") : t.t("whenLegend")}
                  </legend>
                  {lens.options.map((o) => {
                    const sub = o.id === "today" ? formatDay(today) : nextWindow(o.windows, today)?.label;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className="culture-chip"
                        aria-pressed={o.id === option.id}
                        onClick={() => selectOption(lens.query, o.id)}
                      >
                        {o.flag && (
                          <span className="emoji" aria-hidden="true">
                            {o.flag}
                          </span>
                        )}
                        <span lang={o.lang}>{o.label}</span>
                        {sub && <small>{sub}</small>}
                      </button>
                    );
                  })}
                </fieldset>
              </>
            )}
          </div>
        </div>
      </div>

      <aside className="culture-cal" aria-labelledby={`${id}-cal`}>
        <header className="culture-cal-head">
          <h3 id={`${id}-cal`}>{t.t("relevantNow")}</h3>
          <span>{t.t("today", { day: formatDay(today) })}</span>
        </header>
        {calendarRows.length > 0 ? (
          <ol className="culture-cal-list">
            {calendarRows.map(({ item, window: w }) => {
              const live = isLive(w, today);
              const body = (
                <>
                  <span className="culture-cal-node" aria-hidden="true" />
                  <span className="culture-cal-emoji emoji" aria-hidden="true">
                    {item.emoji.join("")}
                  </span>
                  <strong className="culture-cal-title" lang={item.lang}>
                    {item.context}
                  </strong>
                  <small className="culture-cal-meta">
                    {w.label}
                    {item.where && ` · ${item.where}`}
                  </small>
                  <span className="culture-cal-when">
                    {live ? (
                      <>
                        <span className="culture-live" aria-hidden="true" />
                        {t.t("liveNow")}
                      </>
                    ) : (
                      untilLabel(daysBetween(today, w.from), relative)
                    )}
                  </span>
                </>
              );
              return (
                <li key={item.id} className={live ? "is-live" : undefined}>
                  {linked.has(`when:${item.id}`) ? (
                    <button
                      type="button"
                      className="culture-cal-row"
                      onClick={() => openFromCalendar(item.id)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="culture-cal-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="culture-cal-empty">{t.t("calendarEmpty")}</p>
        )}
        <p className="culture-cal-note">{t.t("calendarNote")}</p>
      </aside>
    </div>
  );
}
