import Foundation
import XCTest

@testable import Emojisense

private let portuguese = Pack(
  packVersion: "test", locale: "pt", emojiVersion: "17.0", groups: ["test"],
  emoji: [
    PackRow(emoji: "🎃", hexcode: "1F383", label: "abóbora", alias: "careca nato"),
    PackRow(emoji: "🎂", hexcode: "1F382", label: "bolo de aniversário", keyword: "bolo"),
  ])

/// Ports packages/core/test/locales.test.ts. The Swift engine has no custom packs, so their case
/// is not here.
final class LocalesTests: XCTestCase {
  private let engine = try! AliasEngine(packs: [Fixtures.english, Fixtures.turkish, portuguese])

  private func emoji(_ query: String, locale: String, locales: [String]? = nil) -> [String] {
    engine.search(query, options: AliasSearchOptions(locale: locale, locales: locales)).results
      .map(\.emoji)
  }

  // MARK: Search in the user's languages

  func testMatchesEveryLoadedPackByDefault() {
    XCTAssertEqual(emoji("nato", locale: "en"), ["🎃"])
  }

  func testLeavesOutThePhrasesOfTheOtherLoadedLanguages() {
    XCTAssertEqual(emoji("nato", locale: "en", locales: ["en", "tr"]), [])
    XCTAssertEqual(emoji("bolo", locale: "en", locales: ["en", "tr"]), [])
    XCTAssertEqual(emoji("iyi ki dogdun", locale: "en", locales: ["en", "tr"]), ["🎂"])
  }

  func testNeverCompletesOrCorrectsAWordIntoALanguageTheUserDoesNotHave() {
    XCTAssertTrue(emoji("carec", locale: "en").contains("🎃"))
    XCTAssertEqual(emoji("carec", locale: "en", locales: ["en"]), [])
    XCTAssertTrue(emoji("carecs", locale: "en").contains("🎃"))
    XCTAssertEqual(emoji("carecs", locale: "en", locales: ["en"]), [])
  }

  func testAlwaysSearchesEnglishAndThePreferredLocale() {
    XCTAssertTrue(emoji("thumbsup", locale: "tr", locales: ["tr"]).contains("👍"))
    XCTAssertEqual(emoji("bolo", locale: "pt", locales: ["en"]), ["🎂"])
  }

  func testIsPassedOnByTheSearchSession() {
    let recorder = StateRecorder()
    let session = SearchSession(
      engine: engine, locale: "en", locales: ["en", "tr"], onChange: recorder.record)
    session.update("nato")
    XCTAssertEqual(recorder.last?.results.map(\.emoji), [])
  }

  // MARK: userLocales

  func testMapsTheUsersLanguageTagsToPacksMostPreferredFirstAlwaysWithEnglish() {
    XCTAssertEqual(
      PackLocales.userLocales(languages: ["tr-TR", "en-US", "de", "tr"]), ["tr", "en"])
    XCTAssertEqual(PackLocales.userLocales(languages: ["pt-BR"]), ["pt", "en"])
    XCTAssertEqual(PackLocales.userLocales(languages: ["zh-Hant-TW", "in"]), ["zh", "id", "en"])
    XCTAssertEqual(PackLocales.userLocales(languages: []), ["en"])
  }

  func testKeepsToTheSupportedPacks() {
    XCTAssertEqual(
      PackLocales.userLocales(languages: ["fr", "tr"], supported: ["en", "tr"]), ["tr", "en"])
  }

  func testReadsTheDevicesLanguagesByDefault() {
    XCTAssertEqual(
      PackLocales.userLocales(), PackLocales.userLocales(languages: Locale.preferredLanguages))
    XCTAssertTrue(PackLocales.userLocales().contains("en"))
  }

  // MARK: packLocale(of:)

  func testMapsABCP47TagToItsLanguagesPack() {
    XCTAssertEqual(PackLocales.packLocale(of: "en_US"), "en")
    XCTAssertEqual(PackLocales.packLocale(of: " PT-br "), "pt")
    XCTAssertEqual(PackLocales.packLocale(of: "zh_Hans"), "zh")
    XCTAssertNil(PackLocales.packLocale(of: "de-DE"))
    XCTAssertNil(PackLocales.packLocale(of: ""))
  }
}
