import XCTest

@testable import Emojisense

/// Ports packages/core/test/confidence.test.ts.
final class ConfidenceTests: XCTestCase {
  private func result(_ id: String, _ score: Double, _ source: ResultSource) -> SearchResult {
    SearchResult(emoji: id, id: id, score: score, source: source)
  }

  private func alias(_ confidence: Double, _ coverage: Double, _ ids: [String] = ["A"])
    -> AliasSearchOutput
  {
    let results = ids.enumerated().map { index, id in
      AliasResult(
        emoji: id, id: id, score: confidence - Double(index) * 0.01, label: id, match: "q",
        field: .alias)
    }
    return AliasSearchOutput(
      query: "q", tokens: ["q"], results: results, confidence: confidence, coverage: coverage)
  }

  /// A semantic list: `top`, then four results `gap` below it.
  private func semantic(_ top: Double, _ gap: Double) -> [SearchResult] {
    [result("S1", top, .semantic)]
      + ["S2", "S3", "S4", "S5"].map { result($0, top - gap, .semantic) }
  }

  // MARK: semanticStrength

  func testStrengthIsZeroBelowTheFloorAndOneForAClearTopAtTheCeiling() {
    XCTAssertEqual(Confidence.semanticStrength(semantic(0.4, 0.01)), 0)
    XCTAssertEqual(Confidence.semanticStrength(semantic(0.6, 0.1)), 1)
  }

  func testHalvesTheStrengthOfAFlatTop() {
    let clear = Confidence.semanticStrength(semantic(0.53, 0.06))
    let flat = Confidence.semanticStrength(semantic(0.53, 0))
    XCTAssertEqual(flat, clear / 2, accuracy: 1e-5)
  }

  func testHandlesAListOfOneAndAnEmptyList() {
    XCTAssertEqual(Confidence.semanticStrength([result("S", 0.58, .semantic)]), 1)
    XCTAssertEqual(Confidence.semanticStrength([]), 0)
  }

  // MARK: assess

  func testIsSureWhenTheDictionaryCoversTheQueryWithAConfidentTopResult() {
    XCTAssertTrue(Confidence.aliasCovers(alias(0.9, 1)))
    XCTAssertEqual(
      Confidence.assess(alias: alias(0.9, 1), semantic: semantic(0.4, 0)),
      QueryConfidence(confidence: 0.9, unsure: false))
  }

  func testIsUnsureWithoutCoverageAndWithAFlatOrLowSemanticList() {
    // "kendrick lamar": one word matched, cosines 0.38–0.40.
    XCTAssertTrue(Confidence.assess(alias: alias(0.3, 0.45), semantic: semantic(0.4, 0.01)).unsure)
    XCTAssertTrue(Confidence.assess(alias: alias(0, 0, []), semantic: semantic(0.4, 0.01)).unsure)
  }

  func testIsSureWhenTheSemanticListIsStrongWhateverTheDictionarySays() {
    XCTAssertEqual(
      Confidence.assess(alias: alias(0.3, 0.45), semantic: semantic(0.6, 0.08)),
      QueryConfidence(confidence: 1, unsure: false))
    XCTAssertFalse(Confidence.assess(alias: nil, semantic: semantic(0.6, 0.08)).unsure)
  }

  func testDoesNotCountAWholeMatchWithAWeakTopResultAsCoverage() {
    // "drake" → 🦆 by a weak field: the dictionary has the word, not the meaning.
    XCTAssertFalse(Confidence.aliasCovers(alias(0.58, 1)))
    XCTAssertTrue(Confidence.assess(alias: alias(0.58, 1), semantic: semantic(0.47, 0.01)).unsure)
  }

  func testJudgesByTheDictionaryAloneWithoutASemanticList() {
    XCTAssertFalse(Confidence.assess(alias: alias(0.9, 1), semantic: nil).unsure)
    XCTAssertEqual(
      Confidence.assess(alias: alias(0.7, 0.5), semantic: nil),
      QueryConfidence(
        confidence: (0.7 * (0.5 / Confidence.wholeCoverage) * 1000).rounded() / 1000,
        unsure: true))
  }

  func testNeverCallsAnEmptyQueryUnsure() {
    var empty = alias(0, 0, [])
    empty.tokens = []
    XCTAssertEqual(
      Confidence.assess(alias: empty, semantic: []), QueryConfidence(confidence: 0, unsure: false))
  }

  func testUsesOneThresholdForTheSemanticList() {
    XCTAssertGreaterThan(Confidence.semanticSure, 0)
    let justBelow = semantic(0.44 + 0.14 * (Confidence.semanticSure - 0.01), 0.06)
    XCTAssertTrue(Confidence.assess(alias: alias(0, 0, []), semantic: justBelow).unsure)
  }
}
