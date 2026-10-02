import type { Env } from "./env.ts";

export type Outcome = "hit" | "hit_over_limit" | "miss" | "degraded" | "over_limit";

interface Common {
  locale: string;
  mode: "hybrid" | "semantic";
  outcome: Outcome;
  ms: number;
  aliasConfidence?: number | undefined;
  semanticTop?: number | undefined;
}

/**
 * Only the search variant can carry text. Reaction text is chat content and images are private,
 * so their variants have no field for it: the type system keeps it out of the log.
 */
export type Measurement =
  | (Common & { endpoint: "search"; query: string })
  | (Common & { endpoint: "reactions" | "image" });

/**
 * One Analytics Engine point per request that reached a handler. Layout (keep in sync with the
 * query jobs and packages/worker/README.md):
 *
 *   blob1 normalized query text (search only, ≤ 64 chars; "" otherwise)
 *   blob2 locale · blob3 mode · blob4 outcome · blob5 endpoint
 *   double1 latency ms · double2 alias confidence (−1 = n/a) · double3 top semantic score (−1)
 *   index1 "<packVersion>:<model>@<dims>"
 *
 * No IP, key, app or user id is ever written.
 */
export function record(env: Env, indexTag: string, m: Measurement): void {
  const point = {
    blobs: [m.endpoint === "search" ? m.query : "", m.locale, m.mode, m.outcome, m.endpoint],
    doubles: [m.ms, m.aliasConfidence ?? -1, m.semanticTop ?? -1],
    indexes: [indexTag],
  };
  try {
    env.EVENTS?.writeDataPoint(point);
  } catch {
    // Analytics must never break a response.
  }
}
