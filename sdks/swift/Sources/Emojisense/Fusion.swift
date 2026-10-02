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

  /// Fusion with weights derived from how sure the alias engine is.
  public static func fuse(
    alias: AliasSearchOutput, semantic: [SearchResult], limit: Int = 24
  ) -> [SearchResult] {
    fuseResults(
      alias: alias.results.map(\.searchResult), semantic: semantic,
      options: Options(limit: limit, aliasWeight: 0.4 + alias.confidence, semanticWeight: 1))
  }

  /// Should this query also go to the semantic tier? Yes when the alias engine is unsure, or when
  /// the query is a multi-word phrase without a strong alias hit (conceptual queries).
  public static func shouldUseSemantic(_ alias: AliasSearchOutput) -> Bool {
    if alias.tokens.isEmpty { return false }
    if alias.confidence < 0.6 { return true }
    return alias.tokens.count >= 2 && alias.confidence < 0.9
  }
}
