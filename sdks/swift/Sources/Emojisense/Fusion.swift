/// Merges Tier 0 (alias) and Tier 1 (semantic) rankings, like `packages/core/src/fusion.ts`.
public enum Fusion {
  public struct Options: Sendable {
    /// Reciprocal-rank-fusion constant.
    public var k: Double
    public var limit: Int
    /// Alias results at or above this score keep their place on top, so results do not jump.
    public var pinScore: Double
    /// Alias results at or above this score (below `pinScore`) come before every other result,
    /// ordered among themselves by fused score: semantic evidence breaks their near-ties, but it
    /// cannot lift a clearly weaker alias hit or a semantic-only hit above them. `nil` = off.
    public var aliasFloor: Double?
    public var aliasWeight: Double
    public var semanticWeight: Double

    public init(
      k: Double = 60, limit: Int = 24, pinScore: Double = 0.9, aliasFloor: Double? = nil,
      aliasWeight: Double = 1, semanticWeight: Double = 1
    ) {
      self.k = k
      self.limit = limit
      self.pinScore = pinScore
      self.aliasFloor = aliasFloor
      self.aliasWeight = aliasWeight
      self.semanticWeight = semanticWeight
    }
  }

  /// Weighted reciprocal rank fusion. Confident alias hits stay pinned in their original order,
  /// so the list does not flicker when semantic results arrive. Each result keeps the value (and
  /// `source`) of the list where it appeared first.
  public static func fuseResults(
    alias: [SearchResult], semantic: [SearchResult], options: Options = Options()
  ) -> [SearchResult] {
    let pinned = alias.filter { $0.score >= options.pinScore }
    let pinnedIds = Set(pinned.map(\.id))
    var fused: [(result: SearchResult, score: Double)] = []
    var positionById: [String: Int] = [:]

    func accumulate(_ list: [SearchResult], weight: Double) {
      for (rank, result) in list.enumerated() where !pinnedIds.contains(result.id) {
        let contribution = weight / (options.k + Double(rank) + 1)
        if let position = positionById[result.id] {
          fused[position].score += contribution
        } else {
          positionById[result.id] = fused.count
          fused.append((result, contribution))
        }
      }
    }
    accumulate(alias, weight: options.aliasWeight)
    accumulate(semantic, weight: options.semanticWeight)

    // Stable: equal scores keep first-seen order, as JavaScript's sort does.
    let rest = fused.indices
      .sorted { fused[$0].score != fused[$1].score ? fused[$0].score > fused[$1].score : $0 < $1 }
      .map { fused[$0].result }
    guard let aliasFloor = options.aliasFloor else {
      return Array((pinned + rest).prefix(max(0, options.limit)))
    }
    let floored = Set(alias.filter { $0.score >= aliasFloor }.map(\.id))
    let ordered = rest.filter { floored.contains($0.id) } + rest.filter { !floored.contains($0.id) }
    return Array((pinned + ordered).prefix(max(0, options.limit)))
  }

  /// Score ranges of the semantic model over which its top match goes from "rarely right" to
  /// "usually right". The API sends the one of its model (``SemanticResponse/calibration``).
  public struct SemanticCalibration: Codable, Sendable, Equatable {
    /// Best cosine.
    public var floor: Double
    public var ceiling: Double
    /// Gap between the best cosine and the mean of ranks 2–5. Optional: without it only the best
    /// cosine counts. A name scores low on every emoji but clearly highest on one ("messi" → ⚽
    /// 0.35, the next four 0.24–0.28), so the gap knows it when the cosine does not.
    public var gapFloor: Double?
    public var gapCeiling: Double?

    public init(floor: Double, ceiling: Double, gapFloor: Double? = nil, gapCeiling: Double? = nil)
    {
      self.floor = floor
      self.ceiling = ceiling
      self.gapFloor = gapFloor
      self.gapCeiling = gapCeiling
    }

    /// EmbeddingGemma @768, the production model. Same values as `DEFAULT_SEMANTIC_CALIBRATION`
    /// in packages/core/src/fusion.ts; another model or dims needs its own (`pnpm eval` measures
    /// floor and ceiling).
    public static let standard = SemanticCalibration(
      floor: 0.35, ceiling: 0.53, gapFloor: 0.02, gapCeiling: 0.1)
  }

  /// Candidates each tier brings to fusion, however many results are shown. The reranker's
  /// features read the lists (ranks, the lowest semantic score), so a shorter list would rank
  /// differently: search the alias engine and ask the semantic provider for
  /// `max(limit, rankDepth)` results, then cut the fused list to `limit`. Same value as
  /// `RANK_DEPTH` in packages/core/src/fusion.ts.
  public static let rankDepth = 24

  /// Ranks 2–5, whose mean the best score is compared with.
  private static let gapRanks = 4

  /// How sure the semantic tier is, 0–1: from its best cosine, or from how far that stands out
  /// (the larger).
  public static func semanticConfidence(
    _ semantic: [SearchResult], calibration: SemanticCalibration = .standard
  ) -> Double {
    let scores = semantic.map(\.score).sorted(by: >)
    let best = scores.first ?? 0
    let level = unit((best - calibration.floor) / (calibration.ceiling - calibration.floor))
    let next = scores.dropFirst().prefix(gapRanks)
    guard let gapFloor = calibration.gapFloor, let gapCeiling = calibration.gapCeiling,
      !next.isEmpty
    else { return level }
    let gap = best - next.reduce(0, +) / Double(next.count)
    return max(level, unit((gap - gapFloor) / (gapCeiling - gapFloor)))
  }

  private static func unit(_ value: Double) -> Double {
    min(1, max(0, value))
  }

  /// The semantic list with its unsupported country flags moved after its other results, like
  /// `demoteUnsupportedFlags` in packages/core/src/fusion.ts. A flag is supported when the alias
  /// results hold the same flag or its cosine reaches the calibration ceiling. Short Latin-script
  /// queries the model does not know (romanized text, slang) land near the flag documents.
  static func demoteUnsupportedFlags(
    _ semantic: [SearchResult], alias: [SearchResult],
    calibration: SemanticCalibration = .standard
  ) -> [SearchResult] {
    let aliasIds = Set(alias.map(\.id))
    func supported(_ result: SearchResult) -> Bool {
      !isCountryFlag(result.id) || aliasIds.contains(result.id)
        || result.score >= calibration.ceiling
    }
    if semantic.allSatisfy(supported) { return semantic }
    return semantic.filter(supported) + semantic.filter { !supported($0) }
  }

  /// A country (two regional indicators) or subdivision (black flag + tags) flag, by hexcode.
  static func isCountryFlag(_ id: String) -> Bool {
    let points = id.split(separator: "-").map { UInt32($0, radix: 16) ?? 0 }
    let regionalIndicators: ClosedRange<UInt32> = 0x1F1E6...0x1F1FF
    if points.count == 2 { return points.allSatisfy { regionalIndicators.contains($0) } }
    return points.count > 2 && points[0] == 0x1F3F4 && (0xE0020...0xE007F).contains(points[1])
  }

  /// Alias results this close to a confident top score stay above the rest (`aliasFloor`).
  static let aliasBand = 0.1
  /// Below this alias confidence the alias tier is unsure (as in `shouldUseSemantic`): no floor.
  static let aliasFloorMinConfidence = 0.6

  /// How ``fuse(alias:semantic:limit:calibration:ranking:)`` orders the lists, like `FuseRanking`
  /// in packages/core/src/fusion.ts.
  public struct Ranking: Sendable {
    /// false = the confidence-weighted reciprocal rank fusion (the ranking before the reranker).
    public var rerank: Bool

    public init(rerank: Bool = true) {
      self.rerank = rerank
    }
  }

  /// The learned reranker (``Rerank``) by default: alias hits ≥ 0.9 stay on top in alias order,
  /// then every other candidate of both lists by a linear score over alias and semantic scores,
  /// ranks and confidences; semantic country flags the alias tier does not support go last.
  ///
  /// With `rerank: false`, fusion with weights from how sure each tier is. Alias: 0.4 +
  /// confidence. Semantic: 1 when its best match is strong, down to 0.4 when it is weak, so a weak
  /// semantic list no longer outranks an alias hit. When the alias tier is sure (confidence ≥
  /// 0.6), its results within 0.1 of the top score stay first; the semantic tier reorders them but
  /// cannot push in a clearly weaker one. Semantic country flags the alias tier does not support go
  /// last.
  public static func fuse(
    alias: AliasSearchOutput, semantic: [SearchResult], limit: Int = 24,
    calibration: SemanticCalibration = .standard, ranking: Ranking = Ranking()
  ) -> [SearchResult] {
    let aliasResults = alias.results.map(\.searchResult)
    let guarded = demoteUnsupportedFlags(semantic, alias: aliasResults, calibration: calibration)
    if ranking.rerank {
      let input = Rerank.Input(
        alias: alias, semantic: guarded,
        semanticConfidence: semanticConfidence(guarded, calibration: calibration))
      let ranked = Rerank.rerank(input, limit: Int.max)
      return Array(
        demoteUnsupportedFlags(ranked, alias: aliasResults, calibration: calibration)
          .prefix(max(0, limit)))
    }
    return fuseResults(
      alias: aliasResults, semantic: guarded,
      options: Options(
        limit: limit,
        aliasFloor: alias.confidence >= aliasFloorMinConfidence
          ? alias.confidence - aliasBand : nil,
        aliasWeight: 0.4 + alias.confidence,
        semanticWeight: 0.4 + 0.6 * semanticConfidence(guarded, calibration: calibration)))
  }

  /// Should this query also go to the semantic tier? Yes when the alias engine is unsure, or when
  /// the query is a multi-word phrase without a strong alias hit (conceptual queries).
  public static func shouldUseSemantic(_ alias: AliasSearchOutput) -> Bool {
    if alias.tokens.isEmpty { return false }
    if alias.confidence < 0.6 { return true }
    return alias.tokens.count >= 2 && alias.confidence < 0.9
  }
}
