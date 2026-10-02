import type { CultureLocale } from "../lib/culture";
import { translatorFor } from "./catalogs";
import { LOCALE_INFO, type Locale } from "./locales";

/** The culture model's words and locale for a page language. */
export function cultureLocaleFor(locale: Locale): CultureLocale {
  const { t } = translatorFor(locale);
  return {
    locale,
    tag: LOCALE_INFO[locale].tag,
    words: {
      today: t("culture.model.today"),
      everywhere: t("culture.model.everywhere"),
      everywhereLower: t("culture.model.everywhereLower"),
      // Kept as a template: the model fills in the place.
      lasting: t("culture.model.lasting", { where: "{where}" }),
      seasonal: t("culture.model.seasonal"),
      event: t("culture.model.event"),
      fromCalendar: t("culture.model.fromCalendar"),
      proposedByAi: t("culture.model.proposedByAi"),
      addedByEditor: t("culture.model.addedByEditor"),
    },
  };
}
