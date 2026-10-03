import { PACK_LOCALES } from "emojisense";

/**
 * Every pack language ships in the extension (copied by scripts/build.ts), so each user's languages
 * work offline. The service worker indexes only the user's languages (`searchLanguages`).
 */
export const BUNDLED_LOCALES: readonly string[] = PACK_LOCALES;

/** The files of dist/packs: the pack manifest, then the core and the ext part of each locale. */
export function packFiles(locales: readonly string[] = BUNDLED_LOCALES): string[] {
  return [
    "manifest.json",
    ...locales.map((locale) => `pack.${locale}.json`),
    ...locales.map((locale) => `pack.${locale}.ext.json`),
  ];
}
