import XCTest

@testable import Emojisense

/// Ports packages/core/test/query-repair.test.ts (PACK_FORMAT.md §4).
final class QueryRepairTests: XCTestCase {
  private static let english = Pack(
    packVersion: "test", locale: "en", emojiVersion: "17.0", groups: ["test"],
    emoji: [
      PackRow(emoji: "👋", hexcode: "1F44B", label: "waving hand", alias: "hello|hallo"),
      PackRow(emoji: "🤘", hexcode: "1F918", label: "sign of the horns", alias: "hell yeah"),
      PackRow(emoji: "🎃", hexcode: "1F383", label: "jack-o-lantern", alias: "halloween"),
      PackRow(emoji: "🫟", hexcode: "1FADF", label: "splatter", alias: "messy"),
      PackRow(emoji: "🐘", hexcode: "1F418", label: "elephant"),
      PackRow(emoji: "🌈", hexcode: "1F308", label: "rainbow"),
      PackRow(emoji: "☔", hexcode: "2614", label: "umbrella with rain drops", keyword: "rain"),
    ])

  private let engine = try! AliasEngine(packs: [english])

  private func top(_ query: String) -> AliasResult? {
    engine.search(query).results.first
  }

  // MARK: Completion of a whole word

  func testACompletionOfAWholeWordRanksBelowTheWordItself() {
    // "hell" is a word ("hell yeah"), so "hello" is a weak completion of it.
    XCTAssertEqual(top("hell")?.emoji, "🤘")
  }

  func testACompletionIsUntouchedWhileTheWordIsNotOneYet() {
    XCTAssertEqual(top("hel")?.emoji, "👋")
  }

  // MARK: Typo of a short token

  func testATypoOfAShortTokenScoresBelowATypoOfALongerOne() {
    // One edit each: "messi" (5) → "messy", "elephnt" (7) → "elephant".
    let short = (top("messi")?.score ?? 0) / (top("messy")?.score ?? 1)
    let long = (top("elephnt")?.score ?? 0) / (top("elephant")?.score ?? 1)
    XCTAssertLessThan(short, long)
    XCTAssertEqual(short, 0.7 * 0.9, accuracy: 0.005)
  }

  // MARK: A word split by a space

  func testASplitWordIsAlsoSearchedJoinedSlightlyBelowTheJoinedWordItself() throws {
    let split = engine.search("hallo ween")
    let first = try XCTUnwrap(split.results.first)
    XCTAssertEqual(first.emoji, "🎃")
    XCTAssertEqual(first.score, (top("halloween")?.score ?? 0) * 0.95, accuracy: 0.0005)
    XCTAssertEqual(split.confidence, first.score)
    XCTAssertEqual(split.coverage, 1)
    // The words as typed still count: the greeting stays in the list.
    XCTAssertTrue(split.results.map(\.emoji).contains("👋"))
    XCTAssertEqual(split.query, "hallo ween")
  }

  func testASplitWordJoinsOnlyIntoAVocabularyWord() {
    XCTAssertEqual(top("rain bow")?.emoji, "🌈")
    XCTAssertFalse(engine.search("rain drops").results.map(\.emoji).contains("🌈"))
  }
}
