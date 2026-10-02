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

  private func aliasOutput(_ confidence: Double, _ emoji: [String]) -> AliasSearchOutput {
    let results = emoji.enumerated().map { index, value in
      AliasResult(
        emoji: value, id: value, score: confidence - Double(index) * 0.01, label: value, match: "q",
        field: .alias)
    }
    return AliasSearchOutput(query: "q", tokens: ["q"], results: results, confidence: confidence)
  }

  private func semanticList(_ best: Double) -> [SearchResult] {
    ["S1", "S2", "S3", "S4"].enumerated().map { result($1, best - Double($0) * 0.01, .semantic) }
  }

  func testMapsTheBestCosineBetweenTheCalibrationFloorAndCeiling() {
    XCTAssertEqual(Fusion.semanticConfidence([]), 0)
    XCTAssertEqual(Fusion.semanticConfidence(semanticList(0.4)), 0)
    XCTAssertEqual(Fusion.semanticConfidence(semanticList(0.51)), 0.5, accuracy: 1e-9)
    XCTAssertEqual(Fusion.semanticConfidence(semanticList(0.8)), 1)
    XCTAssertEqual(
      Fusion.semanticConfidence(
        semanticList(0.5), calibration: Fusion.SemanticCalibration(floor: 0.2, ceiling: 0.6)),
      0.75, accuracy: 1e-9)
  }

  func testKeepsAnUnsureAliasHitAboveAWeakSemanticList() {
    let fused = Fusion.fuse(alias: aliasOutput(0.45, ["A1", "A2"]), semantic: semanticList(0.42), limit: 4)
    XCTAssertEqual(fused.map(\.emoji), ["A1", "A2", "S1", "S2"])
  }

  func testStillLetsASureSemanticListLeadAnUnsureAliasList() {
    let fused = Fusion.fuse(alias: aliasOutput(0.45, ["A1", "A2"]), semantic: semanticList(0.7), limit: 4)
    XCTAssertEqual(fused.map(\.emoji), ["S1", "S2", "S3", "S4"])
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
