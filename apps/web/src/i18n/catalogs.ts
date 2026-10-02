/**
 * The catalogs, for build-time code only (Astro pages and components). Islands get the part they
 * need as a prop, so no browser ever downloads a whole catalog.
 */
import en from "./en.json";
import { DEFAULT_LOCALE, LOCALE_INFO, LOCALES, type Locale } from "./locales";
import { type Catalog, createTranslator, isPlural, type MessageValue, type Translator } from "./translate";

export type Messages = typeof en;

const files = import.meta.glob<{ default: Catalog }>("./*.json", { eager: true });

function catalogFile(locale: Locale): Catalog | undefined {
  return files[`./${locale}.json`]?.default;
}

/**
 * A missing key falls back to English, so a catalog that lags behind never breaks the build.
 * The tests require every catalog to have every key, so the fallback stays a safety net.
 */
function withFallback(base: MessageValue, own: MessageValue | undefined): MessageValue {
  if (typeof base === "string") return typeof own === "string" ? own : base;
  if (isPlural(base)) return isPlural(own) ? own : base;
  const ownObject = typeof own === "object" && !isPlural(own) ? (own as Catalog) : {};
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [key, withFallback(value, ownObject[key])]),
  );
}

const cache = new Map<Locale, Messages>();

export function messagesFor(locale: Locale): Messages {
  let messages = cache.get(locale);
  if (!messages) {
    const own = locale === DEFAULT_LOCALE ? undefined : catalogFile(locale);
    messages = (own ? withFallback(en as Catalog, own) : en) as Messages;
    cache.set(locale, messages);
  }
  return messages;
}

const translators = new Map<Locale, Translator<Messages>>();

/** The translator of a page: `t("nav.pricing")`. Its `locale` is the Intl tag ("zh-Hans"). */
export function translatorFor(locale: Locale): Translator<Messages> {
  let translator = translators.get(locale);
  if (!translator) {
    translator = createTranslator(messagesFor(locale), LOCALE_INFO[locale].tag);
    translators.set(locale, translator);
  }
  return translator;
}

export { LOCALES };
