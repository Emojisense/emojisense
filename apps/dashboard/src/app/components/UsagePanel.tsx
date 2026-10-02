import { useEffect, useId, useMemo, useState } from "react";
import type { AppSummary, UsageResponse } from "../../shared/contract";
import { api, errorMessage } from "../api";
import { formatPeriod, recentPeriods } from "../format";
import { ErrorState, LoadingState } from "../ui/Feedback";
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
            This calendar month (UTC), for every app of the account against the {usage?.plan.name ?? ""} plan.
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
        {usage && <UsageReport usage={usage} />}
      </div>
      <div className="card-foot">
        <span>
          Plan limits count the calls of every app of the account. Over a limit, the API answers with{" "}
          <code className="code-inline">overLimit: true</code> and search keeps working on the device.
          Counters can lag a few minutes.
        </span>
      </div>
    </section>
  );
}

function UsageReport({ usage }: { usage: UsageResponse }) {
  // Custom emoji are stored rows, not calls: stored emoji do not make a month without calls busy.
  const idle = usage.metrics.every((metric) => metric.metric === "custom_emoji" || metric.used === 0);
  return (
    <>
      {idle && (
        <div className="usage-idle">
          <span className="emoji" aria-hidden="true">
            🌱
          </span>
          <div>
            <h3 className="usage-idle-title">No calls in {formatPeriod(usage.period)}</h3>
            <p className="hint">
              Usage shows up after your app calls the API with one of its keys. On-device and shard results
              are free and never counted.
            </p>
          </div>
        </div>
      )}
      <div className="meters">
        {usage.metrics.map((metric) => (
          <UsageMeter key={metric.metric} usage={metric} planName={usage.plan.name} />
        ))}
      </div>
    </>
  );
}
