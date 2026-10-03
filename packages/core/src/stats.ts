import { normalize } from "./normalize.js";
import type { SessionState } from "./session.js";

/**
 * How a keystroke's search ended: on the device (`device`), from memory with no request
 * (`memory`: a loaded shard or an answer seen before), from a shard file (`shard`) or the API
 * (`api`), with no layer answering (`none`: a miss or over the limit), with an error, or replaced
 * by the next keystroke while it waited (`cancelled`).
 */
export type SearchOutcome = "device" | "memory" | "shard" | "api" | "none" | "error" | "cancelled";

export interface StatsReporterOptions {
  /** Where `POST /v1/events` is, e.g. "https://stats.emojisense.com". */
  endpoint: string;
  /** Publishable key (`pk_…`): the counts are shown for its app. Without one they count as anonymous. */
  key?: string;
  /** Share of sessions that report at all, 0–1. Default 0.1. */
  sampleRate?: number;
  locale?: string;
  /** Picks kept per report. Default 50. */
  maxPicks?: number;
  /** Default: `navigator.sendBeacon`, else `fetch` with `keepalive`. */
  send?: (url: string, body: string) => void;
  random?: () => number;
}

export interface StatsReporter {
  /** Pass every state a search session reports (its `onChange`). */
  observe(state: SessionState): void;
  /** The person chose an emoji (its hexcode) for a query. */
  pick(query: string, id: string): void;
  /** Send what was counted. Also runs when the page is hidden. */
  flush(): void;
  dispose(): void;
}

const OUTCOMES: readonly SearchOutcome[] = ["device", "memory", "shard", "api", "none", "error", "cancelled"];

function defaultSend(url: string, body: string) {
  if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, body)) return;
  // text/plain keeps the request simple: no CORS preflight.
  void fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(
    () => {},
  );
}

/**
 * Counts how searches end and which emoji people pick, and sends them in one small report per page
 * view (docs/API.md, "Events"). Only a sample of sessions report (`sampleRate`); a session outside
 * the sample does nothing. Counts and picks only: no timing, no device or user id.
 */
export function createStatsReporter(options: StatsReporterOptions): StatsReporter {
  const sampleRate = options.sampleRate ?? 0.1;
  const maxPicks = options.maxPicks ?? 50;
  const send = options.send ?? defaultSend;
  const sampled = (options.random ?? Math.random)() < sampleRate;
  const counts = new Map<SearchOutcome, number>();
  const picks: [string, string][] = [];
  /** The query that waits for a semantic answer. */
  let pending: string | undefined;

  const count = (outcome: SearchOutcome) => counts.set(outcome, (counts.get(outcome) ?? 0) + 1);

  const flush = () => {
    if (counts.size === 0 && picks.length === 0) return;
    const params = new URLSearchParams(options.key ? { key: options.key } : {});
    const body = {
      v: 1,
      sample: sampleRate,
      ...(options.locale ? { locale: options.locale } : {}),
      counts: Object.fromEntries(OUTCOMES.map((o) => [o, counts.get(o) ?? 0])),
      picks: picks.splice(0),
    };
    counts.clear();
    const query = params.toString();
    send(
      `${options.endpoint.replace(/\/+$/, "")}/v1/events${query ? `?${query}` : ""}`,
      JSON.stringify(body),
    );
  };

  const onHide = () => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") flush();
  };
  const listening = sampled && typeof addEventListener === "function";
  if (listening) {
    addEventListener("visibilitychange", onHide);
    addEventListener("pagehide", onHide);
  }

  if (!sampled) return { observe() {}, pick() {}, flush() {}, dispose() {} };
  return {
    observe(state) {
      const { query, status } = state;
      if (pending !== undefined && (pending !== query || status === "idle")) count("cancelled");
      const waited = pending === query;
      pending = status === "loading" ? query : undefined;
      if (status === "alias") count(waited ? "none" : "device");
      else if (status === "error") count("error");
      else if (status === "fused")
        count(state.semanticMs === 0 ? "memory" : state.layer === "shard" ? "shard" : "api");
    },
    pick(query, id) {
      const q = normalize(query);
      if (q !== "" && picks.length < maxPicks) picks.push([q.slice(0, 64), id]);
    },
    flush,
    dispose() {
      if (listening) {
        removeEventListener("visibilitychange", onHide);
        removeEventListener("pagehide", onHide);
      }
      flush();
    },
  };
}
