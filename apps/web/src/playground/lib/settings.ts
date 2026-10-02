/**
 * Playground settings and their shareable form in the URL: `?q=&locale=&mode=&limit=&edge=always`
 * for search, and the hash (`#reactions`, `#photo`) for the open tab. Only values that differ from
 * the defaults are written, so the plain page keeps a clean URL.
 */
import { DEMO_LOCALES } from "../../lib/engine-client";

export type Locale = (typeof DEMO_LOCALES)[number];
export const LOCALES: readonly Locale[] = DEMO_LOCALES;

/** Native names, so every visitor finds their own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
  hi: "हिन्दी",
  ar: "العربية",
  fr: "Français",
  bn: "বাংলা",
  pt: "Português",
  ru: "Русский",
  id: "Bahasa Indonesia",
  tr: "Türkçe",
};

/**
 * `alias`: the on-device dictionary only, no network. `hybrid`: on device first, then the edge
 * fused in (what the SDK does). `semantic`: the edge meaning search alone.
 */
export type Mode = "alias" | "hybrid" | "semantic";
export const MODES: readonly Mode[] = ["alias", "hybrid", "semantic"];
export const MODE_NAMES: Record<Mode, string> = {
  alias: "On device",
  hybrid: "Hybrid",
  semantic: "Meaning only",
};

export const TABS = ["search", "reactions", "photo"] as const;
export type Tab = (typeof TABS)[number];

/** The API accepts 1–50 (docs/API.md). */
export const MAX_LIMIT = 50;
export const LIMIT_OPTIONS = [6, 12, 24, 50] as const;

export interface SearchSettings {
  query: string;
  locale: Locale;
  mode: Mode;
  limit: number;
  /** Hybrid only: ask the edge for every query, not only when the dictionary is unsure. */
  alwaysEdge: boolean;
}

export const DEFAULT_SETTINGS: SearchSettings = {
  query: "jurassic park",
  locale: "en",
  mode: "hybrid",
  limit: 24,
  alwaysEdge: false,
};

/** Same cap as the engine and the API (`MAX_QUERY_LENGTH`). */
const MAX_QUERY_CHARS = 64;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function parseLimit(raw: string | null): number {
  const value = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(value)) return DEFAULT_SETTINGS.limit;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

/** Reads settings from a query string. Unknown or invalid values fall back to the defaults. */
export function readSettings(search: string): SearchSettings {
  const params = new URLSearchParams(search);
  const query = params.get("q");
  const locale = params.get("locale");
  const mode = params.get("mode");
  return {
    query: query === null ? DEFAULT_SETTINGS.query : query.slice(0, MAX_QUERY_CHARS),
    locale: isLocale(locale) ? locale : DEFAULT_SETTINGS.locale,
    mode: isMode(mode) ? mode : DEFAULT_SETTINGS.mode,
    limit: parseLimit(params.get("limit")),
    alwaysEdge: params.get("edge") === "always",
  };
}

/** The query string for these settings, "" when every value is a default. */
export function writeSettings(settings: SearchSettings): string {
  const params = new URLSearchParams();
  if (settings.query !== DEFAULT_SETTINGS.query) params.set("q", settings.query);
  if (settings.locale !== DEFAULT_SETTINGS.locale) params.set("locale", settings.locale);
  if (settings.mode !== DEFAULT_SETTINGS.mode) params.set("mode", settings.mode);
  if (settings.limit !== DEFAULT_SETTINGS.limit) params.set("limit", String(settings.limit));
  if (settings.mode === "hybrid" && settings.alwaysEdge) params.set("edge", "always");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function readTab(hash: string): Tab {
  const name = hash.replace(/^#/, "");
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : "search";
}
