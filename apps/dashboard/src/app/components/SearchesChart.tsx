import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { AnalyticsDay } from "../api";
import { formatNumber } from "../format";

const HEIGHT = 232;
const MARGIN = { top: 12, right: 4, bottom: 28, left: 44 };
const GAP = 2;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dayLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("en", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** A round axis maximum and step: 0 / 2K / 4K / 6K / 8K. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= raw) ?? 10) * magnitude;
  return { top: step * ticks, step };
}

/** A column with a 4px rounded data end and a square base. */
function topRounded(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return "";
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth || 640);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Searches per day as stacked columns: searches that found a match at the base, searches that
 * found nothing on top. Hover or arrow keys show one day; the table carries every value.
 */
export function SearchesChart({ days, showTable }: { days: AnalyticsDay[]; showTable: boolean }) {
  const [ref, width] = useWidth<HTMLElement>();
  const [active, setActive] = useState<number | null>(null);
  const descriptionId = useId();
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;
  const { top, step } = niceScale(Math.max(0, ...days.map((day) => day.searches)));
  const band = plotWidth / Math.max(1, days.length);
  const barWidth = Math.max(1.5, Math.min(24, band * 0.64, band - GAP));
  const y = (value: number) => baseline - (value / top) * plotHeight;
  const tickValues = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  // Date labels about every 72px, always the last day, never one crowding it.
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotWidth / 72))));
  const lastIndex = days.length - 1;
  const labelIndices = days
    .map((_, index) => index)
    .filter((index) => index === lastIndex || (index % labelEvery === 0 && lastIndex - index >= labelEvery));
  const activeDay = active === null ? null : days[active];

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const last = days.length - 1;
    setActive((index) => {
      if (index === null) return event.key === "ArrowRight" ? 0 : last;
      return Math.min(last, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)));
    });
  }

  const totals = days.reduce(
    (sum, day) => ({ searches: sum.searches + day.searches, misses: sum.misses + day.misses }),
    {
      searches: 0,
      misses: 0,
    },
  );

  return (
    <div className="chart">
      <figure
        ref={ref}
        className="chart-plot"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys step through the days
        tabIndex={0}
        aria-label="Searches per day. Use the left and right arrow keys to read one day."
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <p id={descriptionId} className="visually-hidden">
          {formatNumber(totals.searches)} searches over {days.length} days, {formatNumber(totals.misses)}{" "}
          found nothing.
        </p>
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          {tickValues.map((value) => (
            <g key={value}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(value)}
                y2={y(value)}
                className={value === 0 ? "chart-baseline" : "chart-grid"}
              />
              <text
                x={MARGIN.left - 10}
                y={y(value)}
                className="chart-tick"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {compact.format(value)}
              </text>
            </g>
          ))}
          {active !== null && (
            <rect
              x={MARGIN.left + active * band}
              y={MARGIN.top}
              width={band}
              height={plotHeight}
              className="chart-hover-band"
              rx={Math.min(4, band / 4)}
            />
          )}
          {days.map((day, index) => {
            const x = MARGIN.left + index * band + (band - barWidth) / 2;
            const matched = Math.max(0, day.searches - day.misses);
            const matchTop = y(matched);
            const totalTop = y(day.searches);
            const missHeight = Math.max(0, matchTop - totalTop - (matched > 0 ? GAP : 0));
            const dimmed = active !== null && active !== index;
            return (
              <g key={day.day} className="chart-column" data-dimmed={dimmed || undefined}>
                {day.misses > 0 ? (
                  <>
                    <rect
                      x={x}
                      y={matchTop}
                      width={barWidth}
                      height={baseline - matchTop}
                      className="chart-match"
                    />
                    <path d={topRounded(x, totalTop, barWidth, missHeight)} className="chart-miss" />
                  </>
                ) : (
                  <path d={topRounded(x, matchTop, barWidth, baseline - matchTop)} className="chart-match" />
                )}
              </g>
            );
          })}
          {labelIndices.map((index) => {
            const day = days[index];
            if (!day) return null;
            return (
              <text
                key={day.day}
                x={MARGIN.left + index * band + band / 2}
                y={HEIGHT - 8}
                className="chart-tick"
                textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
              >
                {dayLabel.format(toDate(day.day))}
              </text>
            );
          })}
          {days.map((day, index) => (
            <rect
              key={day.day}
              x={MARGIN.left + index * band}
              y={MARGIN.top}
              width={band}
              height={plotHeight}
              fill="transparent"
              onPointerEnter={() => setActive(index)}
              onPointerMove={() => setActive(index)}
            />
          ))}
        </svg>
        {activeDay && active !== null && (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.min(Math.max(MARGIN.left + active * band + band / 2, 80), width - 80)}px`,
              top: `${Math.max(0, y(activeDay.searches) - 8)}px`,
            }}
            aria-hidden="true"
          >
            <p className="chart-tooltip-day">{dayLong.format(toDate(activeDay.day))}</p>
            <p>
              <span className="key-swatch chart-swatch-match" />
              Found a match <strong>{formatNumber(activeDay.searches - activeDay.misses)}</strong>
            </p>
            <p>
              <span className="key-swatch chart-swatch-miss" />
              No match <strong>{formatNumber(activeDay.misses)}</strong>
            </p>
            <p className="chart-tooltip-foot">
              {formatNumber(activeDay.searches)} searches ·{" "}
              {activeDay.searches ? Math.round((activeDay.misses / activeDay.searches) * 100) : 0}% no match
            </p>
          </div>
        )}
        <p className="visually-hidden" aria-live="polite">
          {activeDay
            ? `${dayLong.format(toDate(activeDay.day))}: ${formatNumber(activeDay.searches)} searches, ${formatNumber(activeDay.misses)} with no match.`
            : ""}
        </p>
      </figure>

      <div className={showTable ? "chart-table table-wrap" : "visually-hidden"}>
        <table className="table">
          <caption className="visually-hidden">Searches per day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="col-num">
                Searches
              </th>
              <th scope="col" className="col-num">
                No match
              </th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((day) => (
              <tr key={day.day}>
                <th scope="row">{dayLong.format(toDate(day.day))}</th>
                <td className="col-num">{formatNumber(day.searches)}</td>
                <td className="col-num">{formatNumber(day.misses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
