import { useId } from "react";
import type { MetricUsage } from "../../shared/contract";
import { formatCompact, formatNumber, METRIC_COPY } from "../format";

function meterNote(usage: MetricUsage, planName: string): string {
  const { hint } = METRIC_COPY[usage.metric];
  switch (usage.status) {
    case "not_included":
      return `Not included in the ${planName} plan.`;
    case "over_limit":
      return `Limit reached. The API answers with overLimit: true for every app of the account until next month. ${hint}`;
    case "near_limit":
      return `${usage.percent}% used: close to the limit. ${hint}`;
    default:
      return usage.limit === null ? hint : `${usage.percent}% used. ${hint}`;
  }
}

/** Only when other apps of the account used the metric too; otherwise the figure says it all. */
function appShare(usage: MetricUsage & { appUsed?: number }): string | null {
  if (usage.appUsed === undefined || usage.appUsed === usage.used) return null;
  return `This app: ${formatNumber(usage.appUsed)} of ${formatNumber(usage.used)}.`;
}

const STATUS_LABEL: Partial<Record<MetricUsage["status"], string>> = {
  near_limit: "Near limit",
  over_limit: "At limit",
};

export function UsageMeter({
  usage,
  planName,
  compact = false,
}: {
  /** `appUsed` (one app's part of the account total) adds a "This app" line. */
  usage: MetricUsage & { appUsed?: number };
  planName: string;
  compact?: boolean;
}) {
  const labelId = useId();
  const noteId = useId();
  const { label } = METRIC_COPY[usage.metric];
  const used = formatNumber(usage.used);
  // Compact meters sit three abreast in narrow columns, so big numbers shorten: "13.1M / 15M".
  const show = compact ? formatCompact : formatNumber;
  const figure =
    usage.limit === null ? `${show(usage.used)} used` : `${show(usage.used)} / ${show(usage.limit)}`;
  const showTrack = usage.limit !== null && usage.status !== "not_included";
  const status = STATUS_LABEL[usage.status];

  return (
    <div className="meter" data-status={usage.status}>
      <div className="meter-head">
        <span id={labelId} className="meter-label">
          {label}
        </span>
        {status && (
          <span className="badge badge-dot" data-tone={usage.status === "over_limit" ? "bad" : "idle"}>
            {status}
          </span>
        )}
      </div>
      {usage.status === "not_included" ? (
        <span className="meter-figure meter-figure-off">—</span>
      ) : (
        <span className="meter-figure">{figure}</span>
      )}
      {showTrack ? (
        // A native <meter> cannot take this track the same way in every browser.
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
            style={{ width: usage.used > 0 ? `max(0.375rem, ${usage.percent}%)` : "0" }}
          />
        </div>
      ) : (
        <div className="meter-track meter-track-off" aria-hidden="true" />
      )}
      {!compact && (
        <p id={noteId} className="meter-note">
          {[appShare(usage), meterNote(usage, planName)].filter(Boolean).join(" ")}
        </p>
      )}
    </div>
  );
}
