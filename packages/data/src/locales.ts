/**
 * Locales with aliases (Tier 0) and CLDR names. English is always loaded; it carries the
 * shortcodes. Owner decision 2026-10-02: wave 1 = the most spoken languages + Turkish.
 */
export interface LocaleInfo {
  code: string;
  name: string;
  native: string;
  /** How people type the language in Latin letters, when that is common in chat. */
  romanized?: string;
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: "en", name: "English", native: "English" },
  { code: "zh", name: "Chinese (Simplified)", native: "中文", romanized: "pinyin without tone marks" },
  { code: "hi", name: "Hindi", native: "हिन्दी", romanized: "Hinglish (Hindi in Latin letters)" },
  { code: "es", name: "Spanish", native: "Español" },
  {
    code: "ar",
    name: "Arabic",
    native: "العربية",
    romanized: "Arabizi (Latin letters and digits such as 3 and 7)",
  },
  { code: "fr", name: "French", native: "Français" },
  { code: "bn", name: "Bengali", native: "বাংলা", romanized: "Banglish (Bengali in Latin letters)" },
  { code: "pt", name: "Portuguese (Brazil)", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский", romanized: "translit (Russian in Latin letters)" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);
/** Locales whose CLDR data comes from cldr-annotations (English comes from Emojibase). */
export const CLDR_LOCALES = LOCALE_CODES.filter((c) => c !== "en");
/** Locales stored in the combined en + tr enrichment files (the first wave). */
export const COMBINED_LOCALES = ["en", "tr"] as const;

export function localeInfo(code: string): LocaleInfo {
  const info = LOCALES.find((l) => l.code === code);
  if (!info) throw new Error(`unknown locale "${code}" (known: ${LOCALE_CODES.join(", ")})`);
  return info;
}
