import Foundation

/// The languages that have a pack, and the user's languages among them, as
/// `packages/core/src/locales.ts`. Load and search only the user's languages
/// (``AliasSearchOptions/locales``), so a user of English and Turkish never gets a match from a
/// Portuguese alias.
public enum PackLocales {
  /// Languages with a published pack. English is always loaded: it carries the shortcodes.
  public static let all = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id", "tr"]

  /// Old language codes that systems still report (Java and Android give Indonesian as "in").
  private static let renamed = ["in": "id"]

  /// The pack locale of a BCP 47 tag, case-insensitive ("pt-BR" → "pt", "zh_Hans" → "zh"), or
  /// `nil` when its language has no pack.
  public static func packLocale(of tag: String, supported: [String] = all) -> String? {
    let language =
      tag.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      .split(omittingEmptySubsequences: false) { $0 == "-" || $0 == "_" }
      .first.map(String.init) ?? ""
    let locale = renamed[language] ?? language
    return supported.contains(locale) ? locale : nil
  }

  /// The user's languages that have a pack, most preferred first, always with English (it carries
  /// the shortcodes): ["tr-TR", "en-US", "de"] → ["tr", "en"]. Load and search only these. The
  /// first one is the locale to prefer in search.
  ///
  /// - Parameters:
  ///   - languages: BCP 47 tags, most preferred first. Default: the device's languages,
  ///     `Locale.preferredLanguages`.
  ///   - supported: Pack locales to choose from. Default: ``all``.
  public static func userLocales(
    languages: [String] = Locale.preferredLanguages, supported: [String] = all
  ) -> [String] {
    var locales: [String] = []
    for tag in languages {
      if let locale = packLocale(of: tag, supported: supported), !locales.contains(locale) {
        locales.append(locale)
      }
    }
    if !locales.contains("en") { locales.append("en") }
    return locales
  }
}
