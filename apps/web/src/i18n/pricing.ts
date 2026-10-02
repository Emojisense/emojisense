import type { PricingLocale } from "../lib/pricing";
import { messagesFor } from "./catalogs";
import { LOCALE_INFO, type Locale } from "./locales";

/** The plan words and number formats of a page language. */
export function pricingLocaleFor(locale: Locale): PricingLocale {
  return {
    tag: LOCALE_INFO[locale].tag,
    words: messagesFor(locale).plans,
  };
}
