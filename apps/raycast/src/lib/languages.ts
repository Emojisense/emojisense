import { execFileSync } from "node:child_process";
import { userLocales } from "emojisense";

/** Value of the `locale` preference that follows the system's first language. */
export const SYSTEM_LANGUAGE = "system";

export interface SearchLanguages {
  /** Labels and ranking. */
  locale: string;
  /** The packs to load. Search never sees another language. */
  locales: string[];
}

export interface SystemLanguageSources {
  platform?: NodeJS.Platform;
  /** The output of `defaults read -g AppleLanguages`. */
  readAppleLanguages?: () => string;
  /** The runtime's locale, a BCP 47 tag. */
  runtimeLocale?: () => string;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/;

/**
 * Parse `defaults read -g AppleLanguages`, an old-style property list array:
 * `(\n    "en-US",\n    "tr-TR"\n)`. Plain tags may come without quotes.
 */
export function parseAppleLanguages(output: string): string[] {
  return output
    .replace(/[()\s"]/g, "")
    .split(",")
    .filter((tag) => LANGUAGE_TAG.test(tag));
}

/**
 * The user's preferred languages, most preferred first. macOS keeps the whole list (System
 * Settings → General → Language & Region); `Intl` knows only one locale. On Windows, or when
 * `defaults` fails, that locale is the only language.
 */
export function systemLanguages(sources: SystemLanguageSources = {}): string[] {
  const {
    platform = process.platform,
    // An absolute path: Raycast starts extensions with a short PATH.
    readAppleLanguages = () =>
      execFileSync("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], {
        encoding: "utf8",
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    runtimeLocale = () => Intl.DateTimeFormat().resolvedOptions().locale,
  } = sources;
  if (platform === "darwin") {
    try {
      const languages = parseAppleLanguages(readAppleLanguages());
      if (languages.length > 0) return languages;
    } catch {
      // No list (a fresh account) or no `defaults`: the runtime's locale still names one language.
    }
  }
  return [runtimeLocale()];
}

/**
 * The languages to search: the chosen one (else the first system language with a pack), the other
 * system languages with a pack, and English, which carries the shortcodes. A user of English and
 * Turkish then never gets a match from a Portuguese alias.
 */
export function chooseLanguages(
  preference: string,
  languages: readonly string[],
  supported: readonly string[],
): SearchLanguages {
  const chosen = preference === SYSTEM_LANGUAGE ? [] : [preference];
  const locales = userLocales({ languages: [...chosen, ...languages], supported });
  return { locale: locales[0] ?? "en", locales };
}
