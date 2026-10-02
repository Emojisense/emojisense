/**
 * The locale of the page being built. Astro's i18n routing sets `Astro.currentLocale` from the
 * URL (/es/pricing/ → "es"); every English-only page is "en".
 */
import { messagesFor, translatorFor } from "./catalogs";
import { DEFAULT_LOCALE, isLocale, type Locale, localizePath } from "./locales";

export function pageLocale(astro: { currentLocale?: string | undefined }): Locale {
  return isLocale(astro.currentLocale) ? astro.currentLocale : DEFAULT_LOCALE;
}

/** Translator and link helper for an Astro component: `const { t, href } = i18nFor(Astro)`. */
export function i18nFor(astro: { currentLocale?: string | undefined }) {
  const locale = pageLocale(astro);
  const translator = translatorFor(locale);
  return {
    ...translator,
    /** The Intl tag for formatting ("zh-Hans"). */
    tag: translator.locale,
    locale,
    /** The catalog, for handing one part of it to an island. */
    messages: messagesFor(locale),
    /** A site path in this page's language (English-only pages stay as they are). */
    href: (path: string) => localizePath(path, locale),
  };
}
