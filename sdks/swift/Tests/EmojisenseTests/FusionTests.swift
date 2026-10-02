import XCTest

@testable import Emojisense

/// Ports packages/core/test/fusion.test.ts.
final class FusionTests: XCTestCase {
  private func result(_ emoji: String, _ score: Double, _ source: ResultSource) -> SearchResult {
    SearchResult(emoji: emoji, id: emoji, score: score, source: source)
  }

  func testKeepsConfidentAliasHitsPinnedOnTopInTheirOrder() {
    let alias = [result("🦖", 0.95, .alias), result("🦕", 0.92, .alias), result("🐊", 0.4, .alias)]
    let semantic = [
      result("🌋", 0.8, .semantic), result("🦕", 0.7, .semantic), result("🦖", 0.6, .semantic),
    ]
    XCTAssertEqual(
      Fusion.fuseResults(alias: alias, semantic: semantic).map(\.emoji), ["🦖", "🦕", "🌋", "🐊"])
  }

  func testBoostsItemsBothTiersAgreeOn() {
    let alias = [result("A", 0.5, .alias), result("B", 0.4, .alias)]
    let semantic = [result("B", 0.9, .semantic), result("C", 0.8, .semantic)]
    let fused = Fusion.fuseResults(alias: alias, semantic: semantic)
    XCTAssertEqual(fused.first?.emoji, "B")
    XCTAssertEqual(fused.first?.source, .alias)
  }

  func testKeepsFirstSeenOrderForEqualScores() {
    let semantic = (0..<5).map { result(String($0), 0.1, .semantic) }
    let fused = Fusion.fuseResults(
      alias: [], semantic: semantic, options: Fusion.Options(semanticWeight: 0))
    XCTAssertEqual(fused.map(\.emoji), ["0", "1", "2", "3", "4"])
  }

  func testRespectsTheLimit() {
    let many = (0..<50).map { result(String($0), 0.1, .semantic) }
    XCTAssertEqual(
      Fusion.fuseResults(alias: [], semantic: many, options: Fusion.Options(limit: 10)).count, 10)
  }

  func testAsksTheSemanticTierOnlyWhenTheAliasTierIsUnsure() {
    let output = { (tokens: [String], confidence: Double) in
      AliasSearchOutput(query: "", tokens: tokens, results: [], confidence: confidence)
    }
    XCTAssertFalse(Fusion.shouldUseSemantic(output([], 0)))
    XCTAssertTrue(Fusion.shouldUseSemantic(output(["x"], 0.5)))
    XCTAssertFalse(Fusion.shouldUseSemantic(output(["x"], 0.8)))
    XCTAssertTrue(Fusion.shouldUseSemantic(output(["x", "y"], 0.8)))
    XCTAssertFalse(Fusion.shouldUseSemantic(output(["x", "y"], 0.95)))
  }
}
