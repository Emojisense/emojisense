import { useEffect, useRef, useState } from "react";
import { serverTotal } from "./lib/edge";
import { formatMs, median } from "./lib/format";
import { MODE_NAMES, type Mode } from "./lib/settings";
import { TimingBars, type TimingRow } from "./TimingBars";
import { DEBOUNCE_MS, type EdgeStatus, type SearchRun } from "./useSearchRun";

export interface SessionStats {
  device: number[];
  edge: number[];
  cached: number;
}

/** Answers per layer in this visit, like the old demo's ticket: proof that most answers never leave the device. */
export function useSessionStats(run: SearchRun | undefined): SessionStats {
  const [stats, setStats] = useState<SessionStats>({ device: [], edge: [], cached: 0 });
  const last = useRef<SearchRun | undefined>(undefined);

  useEffect(() => {
    const previous = last.current;
    if (!run?.query.trim() || run === previous) return;
    last.current = run;
    const deviceMs = run.deviceMs;
    // A session reports one keystroke twice (dictionary first, then fused): count the device once.
    if (deviceMs !== undefined && (previous?.query !== run.query || previous.deviceMs !== deviceMs)) {
      setStats((s) => ({ ...s, device: [...s.device.slice(-199), deviceMs] }));
    }
    const edge = run.edge;
    if (edge.kind === "answered") {
      setStats((s) => ({
        ...s,
        edge: [...s.edge.slice(-199), edge.ms],
        cached: s.cached + (cacheOf(edge) === "miss" ? 0 : 1),
      }));
    }
  }, [run]);

  return stats;
}

type CacheKind = "memory" | "edge" | "browser" | "miss";

function cacheOf(edge: Extract<EdgeStatus, { kind: "answered" }>): CacheKind {
  if (edge.trace && !edge.trace.requested) return "memory";
  if (edge.cached) return "edge";
  // A network round trip cannot be shorter than the server's own time: the browser answered.
  const total = edge.trace ? serverTotal(edge.trace.serverTiming) : undefined;
  return total !== undefined && edge.ms < total ? "browser" : "miss";
}

const CACHE_NOTES: Record<CacheKind, string> = {
  memory: "SDK memory, no request",
  edge: "Edge cache hit",
  browser: "Browser HTTP cache",
  miss: "Miss: Workers AI ran",
};

function edgeNote(edge: EdgeStatus): string {
  switch (edge.kind) {
    case "off":
      return "not used";
    case "offline":
      return "offline";
    case "skipped":
      return `not asked · sure at ${edge.confidence.toFixed(2)}`;
    case "waiting":
      return `waiting · ${DEBOUNCE_MS} ms pause`;
    case "empty":
      return "no answer";
    case "failed":
      return "failed";
    case "answered":
      return "";
  }
}

/** Where the time went for the current query, what was cached, and totals for this visit. */
export function SearchTiming({
  run,
  mode,
  stats,
}: {
  run: SearchRun | undefined;
  mode: Mode;
  stats: SessionStats;
}) {
  const edge = run?.edge ?? { kind: "off" as const };
  const answered = edge.kind === "answered" ? edge : undefined;
  const server = answered?.trace?.requested ? answered.trace.serverTiming : [];
  const rows: TimingRow[] = [
    ...(mode === "semantic" ? [] : [{ label: "On device", ms: run?.deviceMs, tone: "device" as const }]),
    { label: "Edge round trip", ms: answered?.ms, note: answered ? "" : edgeNote(edge) },
    ...server
      .filter((entry) => entry.name !== "total")
      .map((entry) => ({ label: `Server: ${entry.name}`, ms: entry.ms, nested: true })),
    ...server
      .filter((entry) => entry.name === "total")
      .map((entry) => ({ label: "Server: total", ms: entry.ms, nested: true })),
  ];
  const request = answered?.trace?.url ?? (edge.kind === "empty" ? edge.trace?.url : undefined);
  const deviceMedian = median(stats.device);
  const edgeMedian = median(stats.edge);

  return (
    <section className="pg-panel pg-timing-panel" aria-label="Timing">
      <header className="pg-panel-head">
        <h3 className="pg-label">Timing</h3>
        <span className="pg-count">{MODE_NAMES[mode]}</span>
      </header>
      <TimingBars rows={rows} label="Time per step for the current query" />
      <dl className="pg-facts pg-facts-tight">
        <div>
          <dt>Cached</dt>
          <dd>
            {answered
              ? CACHE_NOTES[cacheOf(answered)]
              : edge.kind === "skipped" || edge.kind === "off"
                ? "No request"
                : "–"}
          </dd>
        </div>
        {answered?.degraded && (
          <div>
            <dt>Note</dt>
            <dd>Workers AI was unavailable: dictionary results only.</dd>
          </div>
        )}
        {edge.kind === "failed" && (
          <div>
            <dt>Edge</dt>
            <dd>
              {edge.message}
              {mode === "hybrid" ? " These are on-device results." : ""}
            </dd>
          </div>
        )}
        {edge.kind === "empty" && (
          <div>
            <dt>Edge</dt>
            <dd>No answer (for example, over the monthly limit). The dictionary results stand.</dd>
          </div>
        )}
        {request && (
          <div>
            <dt>Request</dt>
            <dd className="pg-mono pg-request" title={request}>
              GET {request.replace(/^https?:\/\/[^/]+/, "").replace(/([?&]key=)[^&]+/, "$1…")}
            </dd>
          </div>
        )}
      </dl>
      <p className="pg-session">
        <span className="pg-label">This visit</span>
        <span>
          {stats.device.length} on device
          {deviceMedian !== undefined ? ` · median ${formatMs(deviceMedian)}` : ""}
        </span>
        <span>
          {stats.edge.length} from the edge
          {edgeMedian !== undefined ? ` · median ${formatMs(edgeMedian)}` : ""}
          {stats.cached > 0 ? ` · ${stats.cached} cached` : ""}
        </span>
      </p>
    </section>
  );
}
