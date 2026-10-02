import { type Metric, periodOf } from "@emojisense/platform";
import type { Environment } from "../shared/contract";

// The copy is English, so numbers and dates use English formatting too.
const numberFormat = new Intl.NumberFormat("en");
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const monthFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

const dateTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const formatNumber = (value: number) => numberFormat.format(value);
/** 15000000 → "15M"; numbers under 10,000 stay exact. */
export const formatCompact = (value: number) =>
  value < 10_000 ? numberFormat.format(value) : compactFormat.format(value);
export const formatDate = (time: number) => dateFormat.format(time);
export const formatDateTime = (time: number) => dateTimeFormat.format(time);
export const isoDate = (time: number) => new Date(time).toISOString();

/** "just now", "5 minutes ago", "in 6 days" */
export function formatRelative(time: number, now = Date.now()): string {
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), "hour");
  return relativeFormat.format(Math.round(seconds / 86_400), "day");
}

export function formatLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : formatNumber(limit);
}

export function formatPrice(usdMonthly: number): string {
  return usdMonthly === 0 ? "$0" : `$${formatNumber(usdMonthly)}`;
}

/** "2026-10" → "October 2026" */
export function formatPeriod(period: string): string {
  const [year = 1970, month = 1] = period.split("-").map(Number);
  return monthFormat.format(Date.UTC(year, month - 1, 1));
}

/** UTC periods from now back to the month the app was created, newest first, at most `max`. */
export function recentPeriods(since: number, now: number, max = 12): string[] {
  const first = periodOf(since);
  const cursor = new Date(now);
  const periods: string[] = [];
  while (periods.length < max) {
    const period = periodOf(cursor);
    periods.push(period);
    if (period <= first) break;
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return periods;
}

export const METRIC_COPY: Record<Metric, { label: string; hint: string }> = {
  semantic_calls: {
    label: "Semantic calls",
    hint: "Search and reaction calls that reached the API, edge-cached answers included.",
  },
  image_classifications: { label: "Image classifications", hint: "Photo to emoji calls." },
  custom_emoji: { label: "Custom emoji", hint: "Custom emoji stored by every app of the account." },
};

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  prod: "Production",
  staging: "Staging",
  dev: "Development",
};

/** Splits a textarea of origins on new lines and commas. The API validates each entry. */
export function splitOrigins(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}
