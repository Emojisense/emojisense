import XCTest

@testable import Emojisense

/// Ports packages/core/test/rerank.test.ts.
final class RerankTests: XCTestCase {
  private func aliasHit(_ id: String, _ score: Double) -> AliasResult {
    AliasResult(emoji: id, id: id, score: score, label: id, match: "q", field: .alias)
  }

  private func semanticHit(_ id: String, _ score: Double) -> SearchResult {
    SearchResult(emoji: id, id: id, score: score, source: .semantic)
  }

  private func output(_ results: [AliasResult]) -> AliasSearchOutput {
    AliasSearchOutput(
      query: "q", tokens: ["q"], results: results, confidence: results.first?.score ?? 0)
  }

  private func input(
    _ alias: [AliasResult], _ semantic: [SearchResult],
    popularity: (@Sendable (String) -> Double)? = nil
  ) -> Rerank.Input {
    Rerank.Input(
      alias: output(alias), semantic: semantic, semanticConfidence: 0.5, popularity: popularity)
  }

  func testDescribesACandidateByBothListsItsPopularityAndTheConfidences() {
    let features = Rerank.features(
      input(
        [aliasHit("A", 0.8), aliasHit("B", 0.4)], [semanticHit("S", 0.6), semanticHit("B", 0.5)],
        popularity: { $0 == "B" ? 0.7 : 0 }),
      id: "B")
    let expected = [1, 0.4, 0.5, 0.5, 0.5, 0.1, 0.7, 0.32, 0.25]
    XCTAssertEqual(features.count, Rerank.weights.count)
    for (value, want) in zip(features, expected) { XCTAssertEqual(value, want, accuracy: 1e-9) }
  }

  func testScoresACandidateMissingFromTheSemanticListBelowItsLowestResult() {
    let features = Rerank.features(
      input([aliasHit("A", 0.6)], [semanticHit("S", 0.6), semanticHit("T", 0.5)]), id: "A")
    XCTAssertEqual(features[4], 0.48, accuracy: 1e-9)
    XCTAssertEqual(features[5], 0.12, accuracy: 1e-9)
    XCTAssertEqual(Rerank.features(input([aliasHit("A", 0.6)], []), id: "A")[4], 0)
  }

  func testKeepsAliasResultsOf09AndMoreOnTop() {
    let out = Rerank.rerank(
      input([aliasHit("A", 0.95), aliasHit("B", 0.92)], [semanticHit("S", 0.9)]), limit: 3)
    XCTAssertEqual(out.map(\.id), ["A", "B", "S"])
  }

  func testPutsACandidateBothListsHoldAboveOneThatOnlyOneListHolds() {
    let out = Rerank.rerank(
      input(
        [aliasHit("A", 0.5), aliasHit("B", 0.5)], [semanticHit("B", 0.55), semanticHit("C", 0.5)]),
      limit: 3)
    XCTAssertEqual(out.map(\.id), ["B", "A", "C"])
  }

  func testLetsPopularityDecideBetweenOtherwiseEqualCandidates() {
    let alias = [aliasHit("A", 0.5), aliasHit("B", 0.5)]
    XCTAssertEqual(Rerank.rerank(input(alias, []), limit: 2).map(\.id), ["A", "B"])
    let popular = Rerank.rerank(input(alias, [], popularity: { $0 == "B" ? 1 : 0 }), limit: 2)
    XCTAssertEqual(popular.map(\.id), ["B", "A"])
  }

  func testFuseMovesUnsupportedFlagsLast() {
    let flag = SearchResult(emoji: "🇧🇹", id: "1F1E7-1F1F9", score: 0.47, source: .semantic)
    let out = Fusion.fuse(
      alias: output([aliasHit("😄", 0.26)]), semantic: [flag, semanticHit("🐰", 0.43)], limit: 4)
    XCTAssertEqual(out.last?.id, "1F1E7-1F1F9")
  }
}
