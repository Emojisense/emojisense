import {
  ANALYTICS_MIN_QUERY_SEARCHES,
  ANALYTICS_WINDOWS,
  type AnalyticsWindow,
  PLANS,
} from "@emojisense/platform";
import { type ReactNode, useId, useState } from "react";
import { type AnalyticsResponse, api } from "../api";
import { SearchesChart } from "../components/SearchesChart";
import { formatNumber } from "../format";
import { useResource } from "../lib/useResource";
import { Link } from "../router";
import { appHref } from "../routes";
import { useAppDetail } from "../shell/context";
import { EmptyState, ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";
import { Segmented } from "../ui/Segmented";

const dayLong = new Intl.DateTimeFormat("en", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function AnalyticsPage() {
  const { app } = useAppDetail();
  const plan = PLANS[app.plan];
  const retention = plan.analyticsRetentionDays;
  const [range, setRange] = useState<AnalyticsWindow>(30);
  const [data, { reload }] = useResource<AnalyticsResponse>(`analytics:${app.id}:${range}`, () =>
    api.analytics(app.id, range),
  );

  const header = (
    <PageHeader
      title="Analytics"
      documentTitle={`Analytics · ${app.name}`}
      lede="What people search for in this app. Counts only: no user, IP address or message text is kept."
      actions={
        data.status !== "plan" && (
          <Segmented<AnalyticsWindow>
            label="Time range"
            value={range}
            onChange={setRange}
            options={ANALYTICS_WINDOWS.map((window) => ({
              value: window,
              label: `${window} days`,
              disabled: retention > 0 && window > retention && window !== ANALYTICS_WINDOWS[0],
              title:
                retention > 0 && window > retention
                  ? `The ${plan.name} plan keeps ${retention} days of analytics.`
                  : undefined,
            }))}
          />
        )
      }
    />
  );

  if (data.status === "plan") {
    return (
      <>
        {header}
        <PlanGate feature="analytics" plan={data.plan} />
      </>
    );
  }

  return (
    <>
      {header}
      {data.status === "loading" && <LoadingState label="Loading analytics…" rows={4} />}
      {data.status === "error" && <ErrorState message={data.message} onRetry={reload} />}
      {data.status === "ready" && <AnalyticsReport appId={app.id} data={data.data} />}
    </>
  );
}

function AnalyticsReport({ appId, data }: { appId: string; data: AnalyticsResponse }) {
  const [showTable, setShowTable] = useState(false);
  const chartTitleId = useId();
  const searches = data.days.reduce((sum, day) => sum + day.searches, 0);
  const misses = data.days.reduce((sum, day) => sum + day.misses, 0);
  const busiest = data.days.reduce<(typeof data.days)[number] | null>(
    (top, day) => (day.searches > (top?.searches ?? 0) ? day : top),
    null,
  );
  const missRate = searches ? (misses / searches) * 100 : 0;

  if (searches === 0) {
    return (
      <div className="card">
        <EmptyState emoji="🔭" title={`No searches in the last ${data.days.length} days`}>
          Analytics count searches that reach the API with one of this app’s keys. On-device answers stay on
          the device and are never counted.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="stat-row">
        <Stat label="Searches" value={formatNumber(searches)} note={`over ${data.days.length} days`} />
        <Stat
          label="Found nothing"
          value={`${missRate < 10 ? missRate.toFixed(1) : Math.round(missRate)}%`}
          note={`${formatNumber(misses)} searches with no result`}
        />
        <Stat
          label="Busiest day"
          value={busiest ? formatNumber(busiest.searches) : "—"}
          note={busiest ? dayLong.format(new Date(`${busiest.day}T00:00:00Z`)) : ""}
        />
      </div>

      <section className="card" aria-labelledby={chartTitleId}>
        <div className="card-head">
          <div>
            <h2 id={chartTitleId} className="card-title">
              Searches per day
            </h2>
            <ul className="chart-legend" aria-label="Legend">
              <li>
                <span className="key-swatch chart-swatch-match" />
                Found a match
              </li>
              <li>
                <span className="key-swatch chart-swatch-miss" />
                No match
              </li>
            </ul>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={showTable}
            onClick={() => setShowTable(!showTable)}
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
        <div className="card-body">
          <SearchesChart days={data.days} showTable={showTable} />
        </div>
      </section>

      <div className="grid-2">
        <TopList
          title="Top searches"
          sub="What people look for most."
          rows={data.topQueries.map((row) => ({ query: row.query, count: row.searches }))}
          unit="searches"
        />
        <TopList
          title="Searches with no match"
          sub="Each one is a custom emoji waiting to be made."
          rows={data.topMisses.map((row) => ({ query: row.query, count: row.misses }))}
          unit="misses"
          action={(query) => (
            <Link
              to={`${appHref(appId, "emoji")}?new=${encodeURIComponent(query)}`}
              className="btn btn-sm btn-ghost top-action"
              aria-label={`Create a custom emoji for “${query}”`}
            >
              <Icon name="plus" />
              Emoji
            </Link>
          )}
        />
      </div>
      <p className="hint">
        A search shows up in these lists after it was made at least {ANALYTICS_MIN_QUERY_SEARCHES} times in
        the window, so rare, personal text never appears. Day totals count every search.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-note">{note}</p>
    </div>
  );
}

interface TopListProps {
  title: string;
  sub: string;
  rows: { query: string; count: number }[];
  unit: string;
  action?: (query: string) => ReactNode;
}

const TOP_ROWS = 10;

function TopList({ title, sub, rows, unit, action }: TopListProps) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...rows.map((row) => row.count));
  const shown = expanded ? rows : rows.slice(0, TOP_ROWS);
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <div>
          <h2 id={headingId} className="card-title">
            {title}
          </h2>
          <p className="card-sub">{sub}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="card-body hint">Nothing searched often enough yet.</p>
      ) : (
        <ol className="top-list">
          {shown.map((row, index) => (
            <li key={row.query} className="top-row">
              <span className="top-rank num">{index + 1}</span>
              <div className="top-main">
                <div className="top-line">
                  <span className="top-query">{row.query}</span>
                  <span className="top-count num">
                    {formatNumber(row.count)} <span className="visually-hidden">{unit}</span>
                  </span>
                </div>
                <div className="top-bar" aria-hidden="true">
                  <span style={{ width: `${(row.count / max) * 100}%` }} />
                </div>
              </div>
              {action?.(row.query)}
            </li>
          ))}
        </ol>
      )}
      {rows.length > TOP_ROWS && (
        <div className="card-foot">
          <button
            type="button"
            className="link-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? `Show the top ${TOP_ROWS}` : `Show all ${rows.length}`}
          </button>
        </div>
      )}
    </section>
  );
}
