import XCTest

@testable import Emojisense

/// Ports packages/core/test/partial-match.test.ts (PACK_FORMAT.md §4, partial matches).
final class PartialMatchTests: XCTestCase {
  private static func pack(_ locale: String, _ rows: [PackRow]) -> Pack {
    Pack(packVersion: "test", locale: locale, emojiVersion: "17.0", groups: ["test"], emoji: rows)
  }

  private static func row(
    _ emoji: String, _ hexcode: String, _ label: String, keyword: String = "", alias: String = ""
  ) -> PackRow {
    PackRow(emoji: emoji, hexcode: hexcode, label: label, keyword: keyword, alias: alias)
  }

  private static let english = pack(
    "en",
    [
      row("🪨", "1FAA8", "rock"),
      row("🚀", "1F680", "rocket", keyword: "space"),
      row("🪔", "1FA94", "diya lamp", keyword: "lamp"),
      row("🦙", "1F999", "llama"),
      row("💍", "1F48D", "ring", keyword: "wedding"),
      row("🧎", "1F9CE", "person kneeling"),
      row("🐈", "1F408", "cat"),
    ])
  private static let turkish = pack(
    "tr",
    [
      row("🪨", "1FAA8", "kaya"), row("🚀", "1F680", "roket"), row("🪔", "1FA94", "kandil"),
      row("🦙", "1F999", "lama"), row("💍", "1F48D", "yüzük"), row("🧎", "1F9CE", "diz çöken kişi"),
      row("🐈", "1F408", "kedi"),
    ])
  private static let indonesian = pack(
    "id",
    [
      row("🪨", "1FAA8", "batu"), row("🚀", "1F680", "roket"), row("🪔", "1FA94", "pelita"),
      row("🦙", "1F999", "llama"), row("💍", "1F48D", "cincin", alias: "lamaran"),
      row("🧎", "1F9CE", "orang berlutut", alias: "lamar pacar"), row("🐈", "1F408", "kucing"),
    ])

  private let englishTurkish = try! AliasEngine(packs: [english, turkish])
  private let englishIndonesian = try! AliasEngine(packs: [english, indonesian])

  private func emoji(_ engine: AliasEngine, _ query: String, locale: String = "en") -> [String] {
    engine.search(query, options: AliasSearchOptions(locale: locale)).results.map(\.emoji)
  }

  private func coverage(_ engine: AliasEngine, _ query: String, locale: String = "en") -> Double {
    engine.search(query, options: AliasSearchOptions(locale: locale)).coverage
  }

  // MARK: Short tokens need stronger evidence for a typo match

  func testNeverReadsAShortTokenAsAWordItExtends() {
    // "rockt" → "rocket" (a letter left out), not "rock" (a letter more).
    XCTAssertEqual(emoji(englishTurkish, "rockt").first, "🚀")
    XCTAssertFalse(emoji(englishTurkish, "rockt").contains("🪨"))
  }

  func testMatchesAShortTypoOnlyToAWordOfThePreferredLocale() {
    // "lamar" is not Turkish "lama" (🦙): a word it extends, in another locale.
    XCTAssertEqual(emoji(englishTurkish, "lamar "), [])
    // "kedu" is a typo of Turkish "kedi" for Turkish users, not for English ones.
    XCTAssertEqual(emoji(englishTurkish, "kedu ", locale: "tr"), ["🐈"])
    XCTAssertEqual(emoji(englishTurkish, "kedu ", locale: "en"), [])
    // A typo of a preferred-locale word still matches: "rcok" → "rock".
    XCTAssertEqual(emoji(englishTurkish, "rcok ").first, "🪨")
  }

  // MARK: A partial match of one token does not stand for a query of unknown words

  func testDropsAPrefixMatchOfOneTokenWhenAnotherTokenMatchesNothing() {
    XCTAssertTrue(emoji(englishTurkish, "roc").contains("🚀"))
    XCTAssertEqual(emoji(englishTurkish, "qzxv roc"), [])
  }

  func testKeepsAnExactWordNextToAnUnknownOne() {
    XCTAssertTrue(emoji(englishTurkish, "qzxv rock").contains("🪨"))
    XCTAssertLessThan(coverage(englishTurkish, "qzxv rock"), Confidence.wholeCoverage)
  }

  // MARK: Prefix completions into another locale's words

  func testRankBelowAnExactWordInAnyLocale() {
    // id "lamar" (in "lamar pacar") is a whole word; id "lamaran" only completes it. A completion
    // of a whole word is weak enough to drop out entirely (`wholeWordCompletionQuality`).
    let results = emoji(englishIndonesian, "lamar")
    XCTAssertEqual(results.firstIndex(of: "🧎"), 0)
    XCTAssertNotEqual(results.firstIndex(of: "💍"), 0)
  }

  func testNeverOutrankAMatchOfThePreferredLocale() throws {
    // "lam" completes en "lamp" and id "lamaran": the English word first.
    XCTAssertEqual(emoji(englishIndonesian, "lam").first, "🪔")
    let output = englishIndonesian.search("lam", options: AliasSearchOptions(locale: "en"))
    let ring = try XCTUnwrap(output.results.first { $0.emoji == "💍" })
    XCTAssertLessThan(ring.score, output.results.first?.score ?? 0)
  }

  func testAreWholeWordsForTheLocaleThatHasThem() {
    XCTAssertEqual(emoji(englishIndonesian, "lamara", locale: "id").first, "💍")
    XCTAssertEqual(coverage(englishIndonesian, "lamara", locale: "id"), 1)
    XCTAssertEqual(coverage(englishIndonesian, "lamara", locale: "en"), 0)
  }

  // MARK: Coverage

  func testCoverageIsTheShareOfTheQueryOnePhraseMatchesWithWholeTokens() {
    XCTAssertEqual(englishTurkish.search("rock").coverage, 1)
    // A completion of the word being typed.
    XCTAssertEqual(englishTurkish.search("rocke").coverage, 1)
    // A typo of the whole word.
    XCTAssertEqual(englishTurkish.search("rockt").coverage, 1)
    XCTAssertEqual(englishTurkish.search("").coverage, 0)
    XCTAssertEqual(englishTurkish.search("qzxv").coverage, 0)
  }
}
