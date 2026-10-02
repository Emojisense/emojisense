/**
 * Rising search phrases for the proposal job, from D1 `trends_daily` through the regional trends
 * reader (src/trends.ts; the 03:17 cron writes it). Every row is k-anonymous and privacy-filtered
 * when it is written, and holds aggregate counts only: nothing here can identify an app, an
 * account or a person.
 */
import { type CultureTrendEvidence, TRENDS_RISING_SCORE } from "@emojisense/platform";
import type { D1Like } from "../store.ts";
import { readRegionalTrends } from "../trends.ts";

export interface RisingQuery {
  locale: string;
  query: string;
  /** Rows of this query, one per country ("*" = the whole locale), highest score first. */
  rows: CultureTrendEvidence[];
  /** The highest score of its rows. */
  score: number;
}

/** Rows read per night: the trends cap is 10,000, and only the top of each group is used. */
const TRENDS_READ_LIMIT = 2_000;

/**
 * The newest day's rising rows (score ≥ TRENDS_RISING_SCORE), at most `perGroup` per
 * (locale, country), grouped by (locale, query) and ordered by score. Locales without a pack
 * (e.g. rows from before migration 0004) are left out.
 */
export async function readRisingQueries(
  db: D1Like,
  options: { perGroup: number; locales: readonly string[]; minScore?: number },
): Promise<RisingQuery[]> {
  const rows = await readRegionalTrends(db, {
    minScore: options.minScore ?? TRENDS_RISING_SCORE,
    limit: TRENDS_READ_LIMIT,
  });
  const locales = new Set(options.locales);
  const taken = new Map<string, number>();
  const byQuery = new Map<string, RisingQuery>();
  for (const row of rows) {
    if (!locales.has(row.locale)) continue;
    const group = `${row.locale}\u0000${row.country}`;
    const count = taken.get(group) ?? 0;
    if (count >= options.perGroup) continue;
    taken.set(group, count + 1);
    const key = `${row.locale}\u0000${row.query}`;
    let trend = byQuery.get(key);
    if (!trend) {
      trend = { locale: row.locale, query: row.query, rows: [], score: 0 };
      byQuery.set(key, trend);
    }
    trend.rows.push({
      day: row.day,
      locale: row.locale,
      country: row.country,
      query: row.query,
      score: Number(row.score),
      searches: Number(row.searches),
    });
    trend.score = Math.max(trend.score, Number(row.score));
  }
  return [...byQuery.values()].sort((a, b) => b.score - a.score || a.query.localeCompare(b.query));
}

/** Where a rising phrase applies: every region when the whole locale rose, else its countries. */
export function trendRegions(trend: RisingQuery): string[] {
  const countries = trend.rows.map((r) => r.country);
  if (countries.includes("*")) return ["*"];
  return [...new Set(countries.filter((c) => /^[A-Z]{2}$/.test(c) && c !== "XX"))].sort();
}
