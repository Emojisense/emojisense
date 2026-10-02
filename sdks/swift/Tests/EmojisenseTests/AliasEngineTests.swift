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

  func testAddsTheEvidenceBonusOnlyForPhrasesOfThePreferredLocale() throws {
    // 🧛 comes first in row order, so a tie would rank it above 🎃.
    var english = Fixtures.english
    english.emoji = [
      PackRow(emoji: "🧛", hexcode: "1F9DB", label: "vampire", keyword: "halloween"),
      PackRow(
        emoji: "🎃", hexcode: "1F383", label: "jack-o-lantern", keyword: "halloween|pumpkin",
        alias: "happy halloween"),
    ]
    var spanish = Fixtures.english
    spanish.locale = "es"
    spanish.emoji = [
      PackRow(
        emoji: "🧛", hexcode: "1F9DB", label: "vampiro",
        alias: "fiesta de halloween|disfraz de halloween|noche de halloween")
    ]
    let multi = try AliasEngine(packs: [english, spanish])
    let first = { (locale: String) in
      multi.search("halloween", options: AliasSearchOptions(locale: locale)).results.first?.emoji
    }
    XCTAssertEqual(first("en"), "🎃")
    XCTAssertEqual(first("es"), "🧛")
  }

  func testRanksAnExactPreferredMatchAboveAnExactMatchOnlyAnotherPackHas() throws {
    var english = Fixtures.english
    english.emoji = [
      PackRow(emoji: "🦶", hexcode: "1F9B6", label: "foot"),
      PackRow(emoji: "🏈", hexcode: "1F3C8", label: "american football", shortcode: "football"),
      PackRow(emoji: "⚽", hexcode: "26BD", label: "soccer ball", keyword: "soccer"),
    ]
    var french = Fixtures.english
    french.locale = "fr"
    french.emoji = [
      PackRow(emoji: "🦶", hexcode: "1F9B6", label: "pied"),
      PackRow(
        emoji: "🏈", hexcode: "1F3C8", label: "football américain", keyword: "ballon ovale"),
      PackRow(
        emoji: "⚽", hexcode: "26BD", label: "ballon de football", keyword: "football",
        alias: "foot"),
    ]
    let multi = try AliasEngine(packs: [english, french])
    let top = { (query: String, locale: String) in
      multi.search(query, options: AliasSearchOptions(locale: locale, prefix: false)).results
        .map { "\($0.emoji) \($0.score)" }
    }
    XCTAssertEqual(Array(top("foot", "fr").prefix(2)), ["⚽ 0.8", "🦶 0.79"])
    XCTAssertEqual(Array(top("football", "fr").prefix(2)), ["⚽ 0.87", "🏈 0.86"])
    XCTAssertEqual(top("soccer", "fr").first, "⚽ 0.782")
    XCTAssertEqual(top("foot", "en").first, "🦶 1.0")
  }

  func testKeepsTheWholeQueryAliasAboveAPartialNameMatchTheEvidenceLifts() throws {
    var english = Fixtures.english
    english.emoji =
      [
        PackRow(
          emoji: "🚢", hexcode: "1F6A2", label: "ship",
          alias: "cargo ship|cruise ship|container ship|i ship it"),
        PackRow(emoji: "🚀", hexcode: "1F680", label: "rocket", alias: "ship it|rocket ship"),
        PackRow(emoji: "📦", hexcode: "1F4E6", label: "package", alias: "ship it"),
      ] + (0..<1000).map { PackRow(emoji: "f\($0)", hexcode: "F\($0)", label: "filler \($0)") }
    let ships = try AliasEngine(packs: [english])
    let top = { (query: String) in
      ships.search(query, options: AliasSearchOptions(prefix: false)).results
        .map { "\($0.emoji) \($0.score)" }
    }
    XCTAssertEqual(Array(top("ship it").prefix(3)), ["🚀 0.9", "📦 0.88", "🚢 0.87"])
    XCTAssertEqual(top("ship").first, "🚢 1.0")
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

  // MARK: Unspaced scripts

  private func chinese() throws -> AliasEngine {
    var zh = Fixtures.english
    zh.locale = "zh"
    zh.emoji = [
      PackRow(emoji: "🎂", hexcode: "1F382", label: "生日蛋糕", keyword: "生日|蛋糕", alias: "生日快乐"),
      PackRow(emoji: "🚀", hexcode: "1F680", label: "火箭", keyword: "火箭", alias: "发射"),
    ]
    return try AliasEngine(packs: [Fixtures.english, zh])
  }

  func testSplitsARunThatIsNotOneTokenLongestFirst() throws {
    let engine = try chinese()
    let search = { (query: String) in engine.search(query, options: AliasSearchOptions(locale: "zh")) }
    XCTAssertEqual(search("今天生日快乐").tokens, ["今天", "生日快乐"])
    XCTAssertEqual(search("今天生日快乐").results.first?.emoji, "🎂")
    XCTAssertEqual(search("火箭发射").tokens, ["火箭", "发射"])
    XCTAssertEqual(search("火箭发射").results.first?.emoji, "🚀")
  }

  func testKeepsUnknownCharactersTogetherAsOneToken() throws {
    let engine = try chinese()
    let search = { (query: String) in engine.search(query, options: AliasSearchOptions(locale: "zh")) }
    XCTAssertEqual(search("今天的蛋糕").tokens, ["今天的", "蛋糕"])
    XCTAssertEqual(search("今天的蛋糕").results.first?.emoji, "🎂")
    XCTAssertEqual(search("今天的蛋糕呀").tokens, ["今天的", "蛋糕", "呀"])
    XCTAssertEqual(search("今天的蛋糕呀").results, [])
  }

  func testDoesNotSplitAnIndexedTokenOrOneStillBeingTyped() throws {
    let engine = try chinese()
    let search = { (query: String) in engine.search(query, options: AliasSearchOptions(locale: "zh")) }
    XCTAssertEqual(search("生日快乐").tokens, ["生日快乐"])
    XCTAssertEqual(search("生日快").tokens, ["生日快"])
    XCTAssertEqual(search("生日快").results.first?.emoji, "🎂")
    XCTAssertEqual(search("生日快 ").tokens, ["生日", "快"])
    XCTAssertEqual(self.engine.search("rockets").tokens, ["rockets"])
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
