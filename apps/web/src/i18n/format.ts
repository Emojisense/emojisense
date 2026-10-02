/**
 * Numbers, prices and durations in a locale. English keeps the site's own short forms ("$5",
 * "100k", "30 days"), which tests and the share cards rely on; other locales use Intl.
 */
import { formatCount, formatDays, formatUsd } from "../lib/format";

/** 5 → "$5" (en), "5 US$" (es), "US$ 5" (pt). Cents only when the price has them. */
export function formatUsdIn(locale: string, value: number): string {
  if (locale === "en") return formatUsd(value);
  const cents = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents,
    maximumFractionDigits: cents,
  }).format(value);
}

/** 3000000 → "3M" (en), "3 M" (es), "300万" (zh). `unlimited` names Infinity. */
export function formatCountIn(locale: string, value: number, unlimited: string): string {
  if (!Number.isFinite(value)) return unlimited;
  if (locale === "en") return formatCount(value);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** 30 → "30 days", 365 → "1 year", in the locale's words. */
export function formatDaysIn(locale: string, days: number): string {
  if (locale === "en") return formatDays(days);
  const years = days > 0 && days % 365 === 0;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: years ? "year" : "day",
    unitDisplay: "long",
  }).format(years ? days / 365 : days);
}

export function formatNumberIn(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** "A, B and C" in the locale's words. */
export function formatListIn(locale: string, items: string[]): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}
