/** Names for the country and language codes of search analytics (English copy, like the rest). */

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

/** The country the API uses when Cloudflare does not know the request's country. */
export const UNKNOWN_COUNTRY = "XX";
/** The locale of searches counted before locales were. */
export const UNKNOWN_LOCALE = "und";

const REGIONAL_INDICATOR_A = 0x1f1e6;

/** "BR" → "Brazil"; "XX" → "Unknown". */
export function countryName(code: string): string {
  if (code === UNKNOWN_COUNTRY) return "Unknown";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "BR" → 🇧🇷 (two regional indicators); "XX" → 🌐. */
export function countryFlag(code: string): string {
  if (code === UNKNOWN_COUNTRY || !/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - 65));
}

/** "pt" → "Portuguese"; "und" → "Unknown". */
export function localeName(code: string): string {
  if (code === UNKNOWN_LOCALE) return "Unknown";
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}
