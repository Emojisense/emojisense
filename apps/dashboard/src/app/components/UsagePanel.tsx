import { useEffect, useId, useMemo, useState } from "react";
import type { AppSummary, MetricUsage, UsageResponse } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { formatNumber, formatPeriod, METRIC_COPY, recentPeriods } from "../format";
import { EmptyState } from "./EmptyState";

export function UsagePanel({ app }: { app: AppSummary }) {
  const periods = useMemo(() => recentPeriods(app.createdAt, Date.now()), [app.createdAt]);
  const [period, setPeriod] = useState(periods[0] ?? "");
  // The last good report stays on screen while another month loads, so the layout holds still.
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [settled, setSettled] = useState<{ period: string; error: string | null } | null>(null);
  const headingId = useId();
  const selectId = useId();

  useEffect(() => {
    let current = true;
    api.usage(app.id, period).then(
      (result) => {
        if (!current) return;
        setUsage(result);
        setSettled({ period, error: null });
      },
      (caught: unknown) => {
        if (current) setSettled({ period, error: errorMessage(caught) });
      },
    );
    return () => {
      current = false;
    };
  }, [app.id, period]);

  const loading = settled?.period !== period;
  const error = loading ? null : (settled?.error ?? null);

  return (
    <section className="card" aria-labelledby={headingId} aria-busy={loading}>
      <div className="card-head">
        <h2 id={headingId} className="section-title">
          Usage
        </h2>
        <div className="field">
          <label htmlFor={selectId} className="visually-hidden">
            Month
          </label>
          <select
            id={selectId}
            className="input"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {periods.map((option) => (
              <option key={option} value={option}>
                {formatPeriod(option)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="card-body">
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {!usage && !error && (
          <p className="hint" role="status">
            Loading usage…
          </p>
        )}
        {usage && <UsageReport usage={usage} />}
      </div>
    </section>
  );
}

function UsageReport({ usage }: { usage: UsageResponse }) {
  const idle = usage.metrics.every((metric) => metric.used === 0);
  return (
    <>
      {idle && (
        <EmptyState emoji="🌱" title={`No calls in ${formatPeriod(usage.period)}`}>
          Usage shows up after your app calls the API with one of its keys. On-device and shard results are
          free and never counted.
        </EmptyState>
      )}
      <div className="meters">
        {usage.metrics.map((metric) => (
          <UsageMeter key={metric.metric} usage={metric} planName={usage.plan.name} />
        ))}
      </div>
      <p className="hint">
        Over a limit, the API answers with <code>overLimit: true</code> and search keeps working on the
        device. Counters can lag a few minutes, because the API writes them in batches.
      </p>
    </>
  );
}

function meterNote(usage: MetricUsage, planName: string): string {
  const { hint } = METRIC_COPY[usage.metric];
  switch (usage.status) {
    case "not_included":
      return `Not included in the ${planName} plan.`;
    case "over_limit":
      return `Limit reached. The API answers with overLimit: true until next month. ${hint}`;
    case "near_limit":
      return `${usage.percent}% used: close to the limit. ${hint}`;
    default:
      return usage.limit === null ? hint : `${usage.percent}% used. ${hint}`;
  }
}

function UsageMeter({ usage, planName }: { usage: MetricUsage; planName: string }) {
  const labelId = useId();
  const noteId = useId();
  const { label } = METRIC_COPY[usage.metric];
  const used = formatNumber(usage.used);
  const figure = usage.limit === null ? `${used} used` : `${used} / ${formatNumber(usage.limit)}`;
  const showTrack = usage.limit !== null && usage.status !== "not_included";

  return (
    <div className="meter" data-status={usage.status}>
      <div className="meter-head">
        <span id={labelId} className="meter-label">
          {label}
        </span>
        <span className="meter-figure">{figure}</span>
      </div>
      {showTrack && (
        // A native <meter> cannot take this pill track the same way in every browser.
        // biome-ignore lint/a11y/useSemanticElements: role="meter" keeps the semantics
        <div
          className="meter-track"
          role="meter"
          aria-labelledby={labelId}
          aria-describedby={noteId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usage.percent}
          aria-valuetext={`${used} of ${formatNumber(usage.limit ?? 0)} (${usage.percent}%)`}
        >
          {/* Any use shows a sliver, so 0.1% does not look like nothing. */}
          <div
            className="meter-fill"
            style={{ width: usage.used > 0 ? `max(0.625rem, ${usage.percent}%)` : "0" }}
          />
        </div>
      )}
      <p id={noteId} className="hint meter-note">
        {meterNote(usage, planName)}
      </p>
    </div>
  );
}
