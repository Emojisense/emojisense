import { SKIN_TONES, type SkinTone } from "emojisense";

/** chrome.storage.local key. Settings stay on this device: nothing here needs to sync. */
export const SETTINGS_KEY = "settings";

export type LocalePreference = "auto" | "en" | "tr";
export type UiLocale = "en" | "tr";

export interface SemanticSettings {
  /** Off by default: with it on, the query text leaves the device. */
  enabled: boolean;
  /** API base URL, e.g. "https://api.example.com". */
  endpoint: string;
  /** Publishable key (`pk_…`). Optional for local development servers. */
  key: string;
}

export interface Settings {
  locale: LocalePreference;
  skinTone: SkinTone;
  semantic: SemanticSettings;
  /** Experimental Google Docs insertion through a synthetic paste event (see GOOGLE_DOCS_SPIKE.md). */
  docsDirectInsert: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: "auto",
  skinTone: "none",
  semantic: { enabled: false, endpoint: "", key: "" },
  docsDirectInsert: false,
};

const LOCALE_PREFERENCES: readonly LocalePreference[] = ["auto", "en", "tr"];

/** Read stored settings defensively: a field with a wrong type falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const value = isRecord(raw) ? raw : {};
  const semantic = isRecord(value.semantic) ? value.semantic : {};
  return {
    locale: oneOf(value.locale, LOCALE_PREFERENCES, DEFAULT_SETTINGS.locale),
    skinTone: oneOf(value.skinTone, SKIN_TONES, DEFAULT_SETTINGS.skinTone),
    semantic: {
      enabled: typeof semantic.enabled === "boolean" ? semantic.enabled : false,
      endpoint: typeof semantic.endpoint === "string" ? semantic.endpoint : "",
      key: typeof semantic.key === "string" ? semantic.key : "",
    },
    docsDirectInsert: typeof value.docsDirectInsert === "boolean" ? value.docsDirectInsert : false,
  };
}

export function resolveLocale(preference: LocalePreference, uiLanguage: string): UiLocale {
  if (preference !== "auto") return preference;
  return uiLanguage.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export type Check = { ok: true; value: string } | { ok: false; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The endpoint must be HTTPS. Plain HTTP is allowed only for a local development server, so a
 * query never travels unencrypted over a network.
 */
export function checkEndpoint(input: string): Check {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter the API address." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a full address, for example https://api.example.com." };
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    return { ok: false, error: "Use an https:// address (http:// is accepted for localhost only)." };
  }
  if (url.username || url.password) return { ok: false, error: "Remove the user name and password." };
  if (url.search || url.hash) return { ok: false, error: "Remove the query string and the # part." };
  return { ok: true, value: `${url.origin}${url.pathname}`.replace(/\/+$/, "") };
}

/**
 * Only publishable keys belong in a browser extension. A secret key would be readable by anyone
 * who installs the extension, so it is refused with an explicit reason.
 */
export function checkKey(input: string): Check {
  const key = input.trim();
  if (key === "") return { ok: true, value: "" };
  if (key.startsWith("sk_")) {
    return { ok: false, error: "This is a secret key. Use a publishable key (pk_…) in a browser." };
  }
  if (!/^pk_[A-Za-z0-9_]{8,}$/.test(key)) {
    return { ok: false, error: "A publishable key starts with pk_ and has letters and digits only." };
  }
  return { ok: true, value: key };
}

/** The semantic API configuration, or undefined when it is off or incomplete. */
export function semanticConfig(settings: Settings): { endpoint: string; key: string } | undefined {
  if (!settings.semantic.enabled) return undefined;
  const endpoint = checkEndpoint(settings.semantic.endpoint);
  const key = checkKey(settings.semantic.key);
  if (!endpoint.ok || !key.ok) return undefined;
  return { endpoint: endpoint.value, key: key.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
