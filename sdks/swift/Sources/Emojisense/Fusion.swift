/// Merges Tier 0 (alias) and Tier 1 (semantic) rankings, like `packages/core/src/fusion.ts`.
public enum Fusion {
  public struct Options: Sendable {
    /// Reciprocal-rank-fusion constant.
    public var k: Double
    public var limit: Int
    /// Alias results at or above this score keep their place on top, so results do not jump.
    public var pinScore: Double
    public var aliasWeight: Double
    public var semanticWeight: Double

    public init(
      k: Double = 60, limit: Int = 24, pinScore: Double = 0.9, aliasWeight: Double = 1,
      semanticWeight: Double = 1
    ) {
      self.k = k
      self.limit = limit
      self.pinScore = pinScore
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
    return Array((pinned + rest).prefix(max(0, options.limit)))
  }

  /// Cosine range of the semantic model over which its top match goes from "rarely right" to
  /// "usually right".
  public struct SemanticCalibration: Sendable, Equatable {
    public var floor: Double
    public var ceiling: Double

    public init(floor: Double, ceiling: Double) {
      self.floor = floor
      self.ceiling = ceiling
    }

    /// bge-m3 @1024, the production model. Same values as `DEFAULT_SEMANTIC_CALIBRATION` in
    /// packages/core/src/fusion.ts; another model or dims needs its own (`pnpm eval` measures them).
    public static let standard = SemanticCalibration(floor: 0.44, ceiling: 0.58)
  }

  /// How sure the semantic tier is, 0–1, from its best cosine score.
  public static func semanticConfidence(
    _ semantic: [SearchResult], calibration: SemanticCalibration = .standard
  ) -> Double {
    let best = semantic.reduce(0) { max($0, $1.score) }
    let value = (best - calibration.floor) / (calibration.ceiling - calibration.floor)
    return min(1, max(0, value))
  }

  /// Fusion with weights from how sure each tier is. Alias: 0.4 + confidence. Semantic: 1 when
  /// its best match is strong, down to 0.4 when it is weak, so a weak semantic list no longer
  /// outranks an alias hit.
  public static func fuse(
    alias: AliasSearchOutput, semantic: [SearchResult], limit: Int = 24,
    calibration: SemanticCalibration = .standard
  ) -> [SearchResult] {
    fuseResults(
      alias: alias.results.map(\.searchResult), semantic: semantic,
      options: Options(
        limit: limit, aliasWeight: 0.4 + alias.confidence,
        semanticWeight: 0.4 + 0.6 * semanticConfidence(semantic, calibration: calibration)))
  }

  /// Should this query also go to the semantic tier? Yes when the alias engine is unsure, or when
  /// the query is a multi-word phrase without a strong alias hit (conceptual queries).
  public static func shouldUseSemantic(_ alias: AliasSearchOutput) -> Bool {
    if alias.tokens.isEmpty { return false }
    if alias.confidence < 0.6 { return true }
    return alias.tokens.count >= 2 && alias.confidence < 0.9
  }
}
