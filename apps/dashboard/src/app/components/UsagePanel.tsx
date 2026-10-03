import { useEffect, useId, useMemo, useState } from "react";
import type { AppSummary, UsageResponse } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { formatPeriod, METRIC_COPY, recentPeriods } from "../format";
import { isUsageShown } from "../lib/plans";
import { Link } from "../router";
import { appHref } from "../routes";
import { ErrorState, LoadingState } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { UsageMeter } from "../ui/UsageMeter";

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
        <div>
          <h2 id={headingId} className="card-title">
            Usage
          </h2>
          <p className="card-sub">
            Every app of the account counts against the {usage?.plan.name ?? ""} plan.
          </p>
        </div>
        <div>
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
      <div className="card-body stack">
        {error && <ErrorState message={error} />}
        {!usage && !error && <LoadingState label="Loading usage…" rows={2} />}
        {usage && <UsageReport usage={usage} appId={app.id} />}
      </div>
      <div className="card-foot">
        <span>
          Calendar months in UTC. Over a limit, the API answers{" "}
          <code className="code-inline">overLimit: true</code> and search keeps working on the device.
        </span>
      </div>
    </section>
  );
}

function UsageReport({ usage, appId }: { usage: UsageResponse; appId: string }) {
  // Custom emoji are stored rows, not calls: stored emoji do not make a month without calls busy.
  const idle = usage.metrics.every((metric) => metric.metric === "custom_emoji" || metric.used === 0);
  const metrics = usage.metrics.filter(isUsageShown);
  return (
    <>
      {idle && (
        <p className="usage-idle">
          <span className="emoji" aria-hidden="true">
            🌱
          </span>
          <span>
            <strong>No calls in {formatPeriod(usage.period)}.</strong> Usage shows up after your app calls the
            API with a key. On-device answers are free and never counted.
          </span>
        </p>
      )}
      <div className="meters">
        {metrics.map((metric) =>
          metric.status === "not_included" && metric.metric === "custom_emoji" ? (
            <Link key={metric.metric} to={appHref(appId, "emoji")} className="meter-locked">
              <span className="meter-label">{METRIC_COPY[metric.metric].label}</span>
              <span className="meter-locked-text">
                <Icon name="lock" className="meter-locked-icon" />
                See what you get
                <Icon name="arrowRight" className="meter-locked-icon" />
              </span>
            </Link>
          ) : (
            <UsageMeter key={metric.metric} usage={metric} planName={usage.plan.name} brief />
          ),
        )}
      </div>
    </>
  );
}
