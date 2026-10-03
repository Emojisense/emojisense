import {
  ANALYTICS_MIN_QUERY_SEARCHES,
  ANALYTICS_WINDOWS,
  type AnalyticsWindow,
  addDays,
  dayOf,
  lowestPlanWithAnalytics,
  PLANS,
  QUERY_DAYS,
} from "@emojisense/platform";
import type {
  AnalyticsCountry,
  AnalyticsDay,
  AnalyticsLocale,
  AnalyticsResponse,
} from "../../shared/contract";
import { requireAppAccess } from "../access";
import type { AuthedContext } from "../env";
import { HttpError, json, planRequired } from "../http";

const DEFAULT_WINDOW: AnalyticsWindow = 30;
/** Length of each top list. */
export const TOP_QUERIES = 20;
/** Length of the country and language breakdowns. */
export const TOP_BREAKDOWN = 50;

function parseWindow(value: string | null): AnalyticsWindow {
  if (value === null || value === "") return DEFAULT_WINDOW;
  const days = ANALYTICS_WINDOWS.find((window) => String(window) === value);
  if (days !== undefined) return days;
  throw new HttpError(
    400,
    "invalid_request",
    `days must be one of: ${ANALYTICS_WINDOWS.join(", ")}.`,
    "days",
  );
}

/**
 * An optional filter value: a country is ISO 3166-1 alpha-2 (any case; "XX" = unknown), a
 * locale a language code such as "pt" ("und" = rows from before locales were counted).
 */
function parseFilter(value: string | null, field: "country" | "locale"): string | null {
  if (value === null || value === "") return null;
  const normalized = field === "country" ? value.toUpperCase() : value.toLowerCase();
  const valid = field === "country" ? /^[A-Z]{2}$/.test(normalized) : /^[a-z]{2,3}$/.test(normalized);
  if (valid) return normalized;
  throw new HttpError(
    400,
    "invalid_request",
    field === "country"
      ? "country must be an ISO 3166-1 alpha-2 code, e.g. BR."
      : "locale must be a language code, e.g. pt.",
    field,
  );
}

/** `AND` clauses of the optional filters; each binds its value twice. */
const COUNTRY = "AND (? IS NULL OR q.country = ?)";
const LOCALE = "AND (? IS NULL OR q.locale = ?)";

/**
 * Daily totals, top queries and the country and language breakdowns from `query_daily`, which the
 * API Worker flushes in batches and a daily cron prunes to the plan's retention (DECISIONS.md,
 * "Search analytics retention" and "Regional statistics"). `country` and `locale` filter every
 * part but their own breakdown. Only the app's own rows are read. Every team role may read them;
 * the app owner's plan decides retention.
 */
export async function getAnalytics({ url, env, deps, account, params }: AuthedContext): Promise<Response> {
  const { app, plan } = await requireAppAccess(env.DB, account.id, params.id, "view");
  const requested = parseWindow(url.searchParams.get("days"));
  const country = parseFilter(url.searchParams.get("country"), "country");
  const locale = parseFilter(url.searchParams.get("locale"), "locale");
  if (plan.analyticsRetentionDays <= 0) {
    const required = lowestPlanWithAnalytics();
    throw planRequired(required, `Search analytics are part of the ${PLANS[required].name} plan and above.`);
  }

  const window = Math.min(requested, plan.analyticsRetentionDays);
  const to = dayOf(deps.now());
  const from = addDays(to, 1 - window);
  const byCountry = [country, country] as const;
  const byLocale = [locale, locale] as const;
  /**
   * The app's rows of the window, seeked one day at a time (query_daily's key starts with the
   * day, migration 0009); `filters` are the optional country and locale clauses.
   */
  const appRows = (columns: string, filters: string, rest: string) =>
    `WITH RECURSIVE ${QUERY_DAYS}
     SELECT ${columns} FROM days JOIN query_daily q ON q.day = days.day AND q.app_id = ?
     WHERE 1 = 1 ${filters} ${rest}`;
  const range = [from, to, app.id] as const;
  const [totals, topQueries, topMisses, countries, locales] = await Promise.all([
    env.DB.prepare(
      appRows(
        "q.day AS day, SUM(q.searches) AS searches, SUM(q.misses) AS misses",
        `${COUNTRY} ${LOCALE}`,
        "GROUP BY q.day",
      ),
    )
      .bind(...range, ...byCountry, ...byLocale)
      .all<AnalyticsDay>(),
    env.DB.prepare(
      appRows(
        "q.query AS query, SUM(q.searches) AS searches",
        `${COUNTRY} ${LOCALE}`,
        "GROUP BY q.query HAVING SUM(q.searches) >= ? ORDER BY SUM(q.searches) DESC, q.query LIMIT ?",
      ),
    )
      .bind(...range, ...byCountry, ...byLocale, ANALYTICS_MIN_QUERY_SEARCHES, TOP_QUERIES)
      .all<{ query: string; searches: number }>(),
    env.DB.prepare(
      appRows(
        "q.query AS query, SUM(q.misses) AS misses",
        `${COUNTRY} ${LOCALE}`,
        "GROUP BY q.query HAVING SUM(q.misses) > 0 AND SUM(q.searches) >= ? ORDER BY SUM(q.misses) DESC, q.query LIMIT ?",
      ),
    )
      .bind(...range, ...byCountry, ...byLocale, ANALYTICS_MIN_QUERY_SEARCHES, TOP_QUERIES)
      .all<{ query: string; misses: number }>(),
    env.DB.prepare(
      appRows(
        "q.country AS country, SUM(q.searches) AS searches, SUM(q.misses) AS misses",
        LOCALE,
        "GROUP BY q.country ORDER BY SUM(q.searches) DESC, q.country LIMIT ?",
      ),
    )
      .bind(...range, ...byLocale, TOP_BREAKDOWN)
      .all<AnalyticsCountry>(),
    env.DB.prepare(
      appRows(
        "q.locale AS locale, SUM(q.searches) AS searches, SUM(q.misses) AS misses",
        COUNTRY,
        "GROUP BY q.locale ORDER BY SUM(q.searches) DESC, q.locale LIMIT ?",
      ),
    )
      .bind(...range, ...byCountry, TOP_BREAKDOWN)
      .all<AnalyticsLocale>(),
  ]);

  const byDay = new Map(totals.results.map((row) => [row.day, row]));
  const days: AnalyticsDay[] = Array.from({ length: window }, (_, i) => {
    const day = addDays(from, i);
    const row = byDay.get(day);
    return { day, searches: row?.searches ?? 0, misses: row?.misses ?? 0 };
  });
  const body: AnalyticsResponse = {
    days,
    topQueries: topQueries.results,
    topMisses: topMisses.results,
    countries: countries.results,
    locales: locales.results,
    filters: { country, locale },
  };
  return json(body);
}
