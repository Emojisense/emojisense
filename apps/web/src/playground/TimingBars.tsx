import type { CSSProperties } from "react";
import { formatMs } from "./lib/format";

export interface TimingRow {
  label: string;
  /** Undefined: the step did not run, and the row shows `note` instead of a bar. */
  ms?: number | undefined;
  note?: string;
  /** A part of the row above it, e.g. the server's share of a round trip. */
  nested?: boolean;
  tone?: "device" | "edge";
}

/**
 * A small waterfall on one linear scale. On-device answers are a hairline next to an edge round
 * trip, which is the point: the device answers first, the edge refines.
 */
export function TimingBars({ rows, label }: { rows: TimingRow[]; label: string }) {
  const max = Math.max(1, ...rows.map((row) => row.ms ?? 0));
  return (
    <ul className="pg-timing" aria-label={label}>
      {rows.map((row) => (
        <li key={row.label} className="pg-timing-row" data-nested={row.nested || undefined}>
          <span className="pg-timing-label">{row.label}</span>
          <span className="pg-timing-track" aria-hidden="true">
            {row.ms !== undefined && (
              <span
                className="pg-timing-bar"
                data-tone={row.tone ?? "edge"}
                style={{ "--w": `${(row.ms / max) * 100}%` } as CSSProperties}
              />
            )}
          </span>
          <span className="pg-timing-value">
            {row.ms !== undefined ? formatMs(row.ms) : (row.note ?? "–")}
          </span>
        </li>
      ))}
    </ul>
  );
}
