/**
 * The languages of the marketing site. They are the 11 languages of the engine, so a visitor
 * reads the site in the language they search in. Only the pages in LOCALIZED_PAGES exist in
 * every language; docs, the playground, the changelog and the legal pages are English only.
 */
export const LOCALES = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleInfo {
  /** The language's own name, as its speakers write it. */
  name: string;
  dir: "ltr" | "rtl";
  /** BCP 47 tag for `lang` and `hreflang`. */
  tag: string;
  /** Open Graph locale (language_TERRITORY). */
  og: string;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { name: "English", dir: "ltr", tag: "en", og: "en_US" },
  zh: { name: "简体中文", dir: "ltr", tag: "zh-Hans", og: "zh_CN" },
  hi: { name: "हिन्दी", dir: "ltr", tag: "hi", og: "hi_IN" },
  es: { name: "Español", dir: "ltr", tag: "es", og: "es_ES" },
  ar: { name: "العربية", dir: "rtl", tag: "ar", og: "ar_AR" },
  fr: { name: "Français", dir: "ltr", tag: "fr", og: "fr_FR" },
  bn: { name: "বাংলা", dir: "ltr", tag: "bn", og: "bn_BD" },
  pt: { name: "Português", dir: "ltr", tag: "pt", og: "pt_BR" },
  ru: { name: "Русский", dir: "ltr", tag: "ru", og: "ru_RU" },
  id: { name: "Bahasa Indonesia", dir: "ltr", tag: "id", og: "id_ID" },
  tr: { name: "Türkçe", dir: "ltr", tag: "tr", og: "tr_TR" },
};

/** Locales with their own URL prefix (every locale but the default). */
export const PREFIXED_LOCALES = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

/** Pages that exist in every locale, as English paths. */
export const LOCALIZED_PAGES = ["/", "/pricing/", "/waitlist/", "/about/"] as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function splitPath(path: string): { pathname: string; rest: string } {
  const cut = path.search(/[?#]/);
  return cut === -1 ? { pathname: path, rest: "" } : { pathname: path.slice(0, cut), rest: path.slice(cut) };
}

/** True for an English path whose page exists in every locale ("/pricing/", "/#faq"). */
export function isLocalizedPath(path: string): boolean {
  const { pathname } = splitPath(path);
  return (LOCALIZED_PAGES as readonly string[]).includes(pathname === "" ? "/" : pathname);
}

/**
 * The URL of an English site path in `locale`: "/pricing/" → "/es/pricing/", "/#faq" → "/es/#faq".
 * English-only pages and external URLs come back unchanged. Matches Astro's i18n routing with
 * `prefixDefaultLocale: false` and directory URLs.
 */
export function localizePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE || !path.startsWith("/") || !isLocalizedPath(path)) return path;
  const { pathname, rest } = splitPath(path);
  return `/${locale}${pathname === "" ? "/" : pathname}${rest}`;
}

/** The English path of a site URL path: "/es/pricing/" → "/pricing/". */
export function unlocalizePath(path: string): string {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(path);
  if (!match || !isLocale(match[1]) || match[1] === DEFAULT_LOCALE) return path;
  return match[2] ?? "/";
}
