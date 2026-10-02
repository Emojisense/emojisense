/// The learned fusion of the alias and semantic lists (PACK_FORMAT.md §10), like
/// `packages/core/src/rerank.ts`: a linear score over nine features per candidate.
public enum Rerank {
  /// One weight per ``features(_:id:)`` value. The same as `RERANK_WEIGHTS` in packages/core,
  /// trained for bge-m3 @1024 with the popularity prior in the semantic scores.
  public static let weights: [Double] = [
    0.04023, 1.781, 1.697, 0.8871, 13.72, -19.46, 2.342, 2.146, 3.891,
  ]

  public struct Input: Sendable {
    public var alias: AliasSearchOutput
    public var semantic: [SearchResult]
    /// How sure the semantic tier is, 0–1 (``Fusion/semanticConfidence(_:calibration:)``).
    public var semanticConfidence: Double
    /// 0–1 (``AliasEngine/popularity(_:)``); 0 for every emoji when nil.
    public var popularity: (@Sendable (String) -> Double)?

    public init(
      alias: AliasSearchOutput, semantic: [SearchResult], semanticConfidence: Double,
      popularity: (@Sendable (String) -> Double)? = nil
    ) {
      self.alias = alias
      self.semantic = semantic
      self.semanticConfidence = semanticConfidence
      self.popularity = popularity
    }
  }

  /// Alias present (0/1), alias score, 1 / alias rank, alias score / alias confidence, semantic
  /// score (a candidate missing from the semantic list scores 0.02 below its lowest), best
  /// semantic score − semantic score, popularity, alias score × alias confidence, semantic score ×
  /// semantic confidence.
  public static func features(_ input: Input, id: String) -> [Double] {
    let alias = input.alias
    let rank = alias.results.firstIndex { $0.id == id }
    let aliasScore = rank.map { alias.results[$0].score } ?? 0
    var best = 0.0
    var lowest = Double.infinity
    for result in input.semantic {
      best = max(best, result.score)
      lowest = min(lowest, result.score)
    }
    let score =
      input.semantic.first { $0.id == id }?.score ?? (input.semantic.isEmpty ? 0 : lowest - 0.02)
    return [
      rank == nil ? 0 : 1,
      aliasScore,
      rank.map { 1 / Double($0 + 1) } ?? 0,
      rank == nil ? 0 : aliasScore / alias.confidence,
      score,
      best - score,
      input.popularity?(id) ?? 0,
      aliasScore * alias.confidence,
      score * input.semanticConfidence,
    ]
  }

  /// Alias results ≥ 0.9 stay on top in alias order, then every other candidate of both lists by
  /// its learned score; equal scores keep alias-then-semantic order.
  public static func rerank(_ input: Input, limit: Int, weights: [Double] = weights)
    -> [SearchResult]
  {
    let pinned = input.alias.results.filter { $0.score >= 0.9 }.map(\.searchResult)
    var seen = Set(pinned.map(\.id))
    var rest: [(result: SearchResult, score: Double)] = []
    for result in input.alias.results.map(\.searchResult) + input.semantic
    where seen.insert(result.id).inserted {
      // Summed left to right, as the reference does, so scores are bit-for-bit equal.
      var score = 0.0
      for (index, value) in features(input, id: result.id).enumerated() {
        score += value * (index < weights.count ? weights[index] : 0)
      }
      rest.append((result, score))
    }
    let ordered = rest.indices.sorted {
      rest[$0].score != rest[$1].score ? rest[$0].score > rest[$1].score : $0 < $1
    }
    return Array((pinned + ordered.map { rest[$0].result }).prefix(max(0, limit)))
  }
}
