import XCTest

@testable import Emojisense

/// Ports packages/core/test/fusion.test.ts.
final class FusionTests: XCTestCase {
  /// The fusion before the reranker (`rerank: false`), which these `fuse` tests describe.
  private let rrf = Fusion.Ranking(rerank: false)

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

  func testKeepsAliasResultsAboveTheFloorAheadOrderedByFusedScore() {
    let alias = [result("A", 0.8, .alias), result("B", 0.78, .alias), result("C", 0.6, .alias)]
    let semantic = [
      result("C", 0.5, .semantic), result("B", 0.49, .semantic), result("S", 0.48, .semantic),
    ]
    XCTAssertEqual(
      Fusion.fuseResults(alias: alias, semantic: semantic).map(\.emoji), ["C", "B", "A", "S"])
    XCTAssertEqual(
      Fusion.fuseResults(alias: alias, semantic: semantic, options: Fusion.Options(aliasFloor: 0.7))
        .map(\.emoji),
      ["B", "A", "C", "S"])
  }

  private let brazil = "1F1E7-1F1F7"
  private let bhutan = "1F1E7-1F1F9"
  private let scotland = "1F3F4-E0067-E0062-E0073-E0063-E0074-E007F"
  private let chequered = "1F3C1"

  func testMovesFlagsTheAliasTierDoesNotHoldAfterTheOtherResults() {
    let semantic = [
      result(bhutan, 0.45, .semantic), result("🐰", 0.44, .semantic),
      result(scotland, 0.43, .semantic), result(chequered, 0.42, .semantic),
    ]
    XCTAssertEqual(
      Fusion.demoteUnsupportedFlags(semantic, alias: []).map(\.id),
      ["🐰", chequered, bhutan, scotland])
  }

  func testKeepsAFlagTheAliasResultsHoldOrOneAtTheCalibrationCeiling() {
    let semantic = [
      result(brazil, 0.5, .semantic), result(bhutan, 0.58, .semantic), result("💛", 0.4, .semantic),
    ]
    XCTAssertEqual(
      Fusion.demoteUnsupportedFlags(semantic, alias: [result(brazil, 0.86, .alias)]).map(\.id),
      [brazil, bhutan, "💛"])
    XCTAssertEqual(
      Fusion.demoteUnsupportedFlags(semantic, alias: []).map(\.id), [bhutan, "💛", brazil])
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
    let fused = Fusion.fuse(
      alias: aliasOutput(0.45, ["A1", "A2"]), semantic: semanticList(0.42), limit: 4, ranking: rrf)
    XCTAssertEqual(fused.map(\.emoji), ["A1", "A2", "S1", "S2"])
  }

  func testKeepsASureAliasTopAboveAWeakerAliasHitTheSemanticListFavours() {
    let results = [("👍", 0.82), ("🔥", 0.8), ("6️⃣", 0.66)].map { emoji, score in
      AliasResult(emoji: emoji, id: emoji, score: score, label: emoji, match: "666", field: .alias)
    }
    let alias = AliasSearchOutput(query: "666", tokens: ["666"], results: results, confidence: 0.82)
    let semantic = [
      result("6️⃣", 0.46, .semantic), result("🕕", 0.45, .semantic), result("7️⃣", 0.43, .semantic),
    ]
    XCTAssertEqual(
      Fusion.fuse(alias: alias, semantic: semantic, limit: 4, ranking: rrf).map(\.emoji),
      ["👍", "🔥", "6️⃣", "🕕"])
  }

  func testLetsTheSemanticListBreakNearTiesAmongTheTopAliasResults() {
    let semantic = [result("🚀", 0.51, .semantic), result("🦝", 0.5, .semantic)]
    let fused = Fusion.fuse(
      alias: aliasOutput(0.78, ["🪨", "🚀"]), semantic: semantic, limit: 3, ranking: rrf)
    XCTAssertEqual(fused.map(\.emoji), ["🚀", "🪨", "🦝"])
  }

  func testRanksSemanticFlagsTheAliasTierDoesNotHoldAfterTheOtherResults() {
    let flag = SearchResult(emoji: "🇧🇹", id: bhutan, score: 0.44, source: .semantic)
    let semantic = [flag, result("🐰", 0.43, .semantic), result("🐇", 0.42, .semantic)]
    let fused = Fusion.fuse(
      alias: aliasOutput(0.26, ["😄"]), semantic: semantic, limit: 4, ranking: rrf)
    XCTAssertEqual(fused.map(\.emoji), ["😄", "🐰", "🐇", "🇧🇹"])
  }

  func testStillLetsASureSemanticListLeadAnUnsureAliasList() {
    let fused = Fusion.fuse(
      alias: aliasOutput(0.45, ["A1", "A2"]), semantic: semanticList(0.7), limit: 4, ranking: rrf)
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
