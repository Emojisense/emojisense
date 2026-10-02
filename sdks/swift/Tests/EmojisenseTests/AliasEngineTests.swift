import XCTest

@testable import Emojisense

/// Ports packages/core/test/engine.test.ts.
final class AliasEngineTests: XCTestCase {
  private let engine = try! AliasEngine(packs: [Fixtures.english, Fixtures.turkish])

  private func top(_ query: String, locale: String? = nil) -> [String] {
    engine.search(query, options: AliasSearchOptions(locale: locale)).results.map(\.emoji)
  }

  func testRanksAnExactNameFirst() {
    XCTAssertEqual(top("fire").first, "🔥")
    XCTAssertTrue(top("fire").contains("🚒"))
  }

  func testMatchesShortcodesAndAliases() {
    XCTAssertEqual(top("+1").first, "👍")
    XCTAssertEqual(top("lgtm").first, "👍")
    XCTAssertEqual(top("ship it").first, "🚀")
    XCTAssertEqual(top("jurassic park").first, "🦖")
  }

  func testWeightsRareWordsOverStopwords() {
    XCTAssertEqual(top("greatest of all time").first, "🐐")
    XCTAssertEqual(top("the moon").first, "🚀")
  }

  func testCompletesTheTokenBeingTyped() {
    XCTAssertEqual(top("rock").first, "🚀")
    XCTAssertEqual(top("jurassic pa").first, "🦖")
  }

  func testDoesNotPrefixCompleteAfterATrailingSpace() {
    XCTAssertEqual(top("rock "), [])
    XCTAssertEqual(top("rock\u{3000}"), [])
  }

  func testToleratesTypos() {
    XCTAssertEqual(top("hallowelen").first, "🎃")
    XCTAssertEqual(top("rockt").first, "🚀")
    XCTAssertEqual(top("thumbs upp").first, "👍")
    XCTAssertEqual(top("dinasour").first, "🦖")
  }

  func testSearchesAcrossLocalesAndPrefersTheActiveOne() {
    XCTAssertEqual(top("doğum günü", locale: "tr").first, "🎂")
    XCTAssertEqual(top("dogum gunu", locale: "tr").first, "🎂")
    XCTAssertEqual(top("iyi ki doğdun", locale: "tr").first, "🎂")
    XCTAssertEqual(top("rocket", locale: "tr").first, "🚀")
  }

  func testReturnsPerLocaleLabels() {
    let result = engine.search("tamam", options: AliasSearchOptions(locale: "tr")).results.first
    XCTAssertEqual(result?.label, "baş parmak yukarıda")
  }

  func testReturnsNothingForEmptyOrEmojiOnlyQueries() {
    XCTAssertEqual(engine.search("").results, [])
    XCTAssertEqual(engine.search("🚀").results, [])
  }

  func testReportsConfidenceAndTheMatchingPhrase() {
    let output = engine.search("jurassic park")
    XCTAssertGreaterThan(output.confidence, 0.7)
    XCTAssertEqual(output.results.first?.match, "jurassic park")
    XCTAssertEqual(output.results.first?.field, .alias)
    XCTAssertEqual(engine.search("qxzvbn").confidence, 0)
  }

  func testRespectsTheLimit() {
    XCTAssertEqual(engine.search("f", options: AliasSearchOptions(limit: 1)).results.count, 1)
  }

  func testMergesAnExtensionPackOfTheSameLocaleWithoutALocalePenalty() throws {
    var extensionPack = Fixtures.english
    extensionPack.part = .ext
    extensionPack.emoji = [PackRow(emoji: "🐐", hexcode: "1F410", label: "", alias: "the goat")]
    let withExtension = try AliasEngine(
      core: [Fixtures.english, Fixtures.turkish], extensions: [extensionPack])
    let goat = withExtension.search("the goat", options: AliasSearchOptions(locale: "en"))
      .results.first
    XCTAssertEqual(goat?.emoji, "🐐")
    XCTAssertGreaterThan(goat?.score ?? 0, 0.75)
    XCTAssertEqual(withExtension.entry(id: "1F410")?.labels["en"], "goat")
    XCTAssertEqual(withExtension.locales, ["en", "tr"])
  }

  func testLooksUpEntriesById() {
    XCTAssertEqual(engine.entry(id: "1F680")?.emoji, "🚀")
    XCTAssertEqual(engine.entry(id: "1F680")?.labels, ["en": "rocket"])
    XCTAssertNil(engine.entry(id: "nope"))
  }

  func testNeedsAtLeastOnePack() {
    XCTAssertThrowsError(try AliasEngine(packs: [])) { error in
      XCTAssertEqual(error as? EmojisenseError, .noPacks)
    }
  }

  func testIsSafeToSearchConcurrently() async {
    let engine = engine
    let expected = engine.search("jurassic park").results
    await withTaskGroup(of: [AliasResult].self) { group in
      for _ in 0..<16 { group.addTask { engine.search("jurassic park").results } }
      for await results in group { XCTAssertEqual(results, expected) }
    }
  }
}
