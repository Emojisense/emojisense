import { privacyReason } from "@emojisense/data/shards";
import { addDays, dayOf } from "@emojisense/platform";
import { normalize } from "emojisense";
import type { D1Like } from "../store.ts";

/** Inclusive range of UTC days, `YYYY-MM-DD`. */
export interface DayWindow {
  from: string;
  to: string;
}

/** The last `days` complete UTC days before the day of `now`. Today is never read. */
export function selectionWindow(now: number, days: number): DayWindow {
  const today = dayOf(now);
  return { from: addDays(today, -days), to: addDays(today, -1) };
}

export interface SelectionRules {
  minAccounts: number;
  minSearches: number;
  maxQueries: number;
}

export interface Candidate {
  /** Normalized query text, as query_daily holds it. */
  q: string;
  searches: number;
}

export interface Selection {
  candidates: Candidate[];
  /** Rows over the thresholds that privacyReason (or a non-normalized text) kept out. */
  privacyDropped: number;
}

/**
 * Per query, the searches and the number of different accounts whose apps searched it in the
 * window. query_daily holds keyed calls only (anonymous calls and dev keys are never counted),
 * so one person without a key cannot push a text into a public shard file. An account with many
 * apps counts once.
 */
const SELECT_CANDIDATES = `
  SELECT q.query AS q, SUM(q.searches) AS total
  FROM query_daily q JOIN apps a ON a.id = q.app_id
  WHERE q.day BETWEEN ? AND ?
  GROUP BY q.query
  HAVING COUNT(DISTINCT a.account_id) >= ? AND SUM(q.searches) >= ?
  ORDER BY total DESC, q.query
  LIMIT ?`;

/**
 * The queries a shard build may publish, most searched first: over both k-anonymity thresholds
 * in the window, and not personal-looking (privacyReason). Only aggregate counts leave D1: no app,
 * account or day.
 */
export async function selectCandidates(
  db: D1Like,
  window: DayWindow,
  rules: SelectionRules,
): Promise<Selection> {
  const { results } = await db
    .prepare(SELECT_CANDIDATES)
    .bind(window.from, window.to, rules.minAccounts, rules.minSearches, rules.maxQueries)
    .all<{ q: string; total: number }>();
  const candidates: Candidate[] = [];
  let privacyDropped = 0;
  for (const row of results) {
    // A key the SDK can never look up (it normalizes first) would only publish the text.
    if (normalize(row.q) !== row.q || privacyReason(row.q)) privacyDropped++;
    else candidates.push({ q: row.q, searches: Number(row.total) });
  }
  return { candidates, privacyDropped };
}
