import { useEffect, useId, useMemo, useState } from "react";
import type { AppMetricUsage, AppSummary, UsageResponse } from "../../shared/contract";
import { api, type EmojiList, errorMessage } from "../api";
import { formatPeriod, recentPeriods } from "../format";
import { planIncludes } from "../lib/plans";
import { ErrorState, LoadingState } from "../ui/Feedback";
import { UsageMeter } from "../ui/UsageMeter";

/**
 * The usage route counts calls; custom emoji are rows, so it always reports 0 for them. Their
 * meter comes from the custom emoji list instead (`used` / `limit` over the whole account).
 */
function withCustomEmoji(metrics: AppMetricUsage[], list: EmojiList | null): AppMetricUsage[] {
  return metrics.flatMap((metric) => {
    if (metric.metric !== "custom_emoji" || metric.status === "not_included") return [metric];
    if (!list) return [];
    const { used, limit } = list;
    const percent = limit ? Math.min(100, Math.floor((used / limit) * 1000) / 10) : 0;
    const status = limit === null ? "ok" : used >= limit ? "over_limit" : percent >= 80 ? "near_limit" : "ok";
    return [{ ...metric, used, limit, percent, status, appUsed: list.emoji.length }];
  });
}

export function UsagePanel({ app }: { app: AppSummary }) {
  const periods = useMemo(() => recentPeriods(app.createdAt, Date.now()), [app.createdAt]);
  const [period, setPeriod] = useState(periods[0] ?? "");
  // The last good report stays on screen while another month loads, so the layout holds still.
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [settled, setSettled] = useState<{ period: string; error: string | null } | null>(null);
  const [emojiList, setEmojiList] = useState<EmojiList | null>(null);
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

  const customAllowed = planIncludes(app.plan, "custom_emoji");
  useEffect(() => {
    if (!customAllowed) return;
    let current = true;
    api.listEmoji(app.id).then(
      (list) => current && setEmojiList(list),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [app.id, customAllowed]);

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
        {usage && <UsageReport usage={usage} metrics={withCustomEmoji(usage.metrics, emojiList)} />}
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

function UsageReport({ usage, metrics }: { usage: UsageResponse; metrics: AppMetricUsage[] }) {
  const idle = usage.metrics.every((metric) => metric.used === 0);
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
        {metrics.map((metric) => (
          <UsageMeter key={metric.metric} usage={metric} planName={usage.plan.name} />
        ))}
      </div>
    </>
  );
}
