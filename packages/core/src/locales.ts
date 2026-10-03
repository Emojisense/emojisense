/** Languages with a published pack. English is always loaded: it carries the shortcodes. */
export const PACK_LOCALES = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;

export type PackLocale = (typeof PACK_LOCALES)[number];

/** Old language codes that systems still report (Java and Android give Indonesian as "in"). */
const RENAMED: Record<string, string> = { in: "id" };

/**
 * The pack locale of a BCP 47 tag, case-insensitive ("pt-BR" → "pt", "zh_Hans" → "zh"), or
 * undefined when its language has no pack.
 */
export function packLocaleOf(tag: string, supported: readonly string[] = PACK_LOCALES): string | undefined {
  const language = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  const locale = RENAMED[language] ?? language;
  return supported.includes(locale) ? locale : undefined;
}

export interface UserLocalesOptions {
  /** BCP 47 tags, most preferred first. Default: the browser's `navigator.languages`. */
  languages?: readonly string[] | undefined;
  /** Pack locales to choose from. Default: {@link PACK_LOCALES}. */
  supported?: readonly string[] | undefined;
}

function deviceLanguages(): readonly string[] {
  const navigator = globalThis.navigator as { languages?: readonly string[]; language?: string } | undefined;
  if (navigator?.languages?.length) return navigator.languages;
  return navigator?.language ? [navigator.language] : [];
}

/**
 * The user's languages that have a pack, most preferred first, always with English (it carries
 * the shortcodes): ["tr-TR", "en-US", "de"] → ["tr", "en"]. Load and search only these, so a
 * user of English and Turkish never gets a match from a Portuguese alias. The first one is the
 * locale to prefer in search.
 */
export function userLocales(options: UserLocalesOptions = {}): string[] {
  const { supported = PACK_LOCALES } = options;
  const locales: string[] = [];
  for (const tag of options.languages ?? deviceLanguages()) {
    const locale = packLocaleOf(tag, supported);
    if (locale && !locales.includes(locale)) locales.push(locale);
  }
  if (!locales.includes("en")) locales.push("en");
  return locales;
}
