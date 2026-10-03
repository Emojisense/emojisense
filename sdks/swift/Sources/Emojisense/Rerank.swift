/// The learned fusion of the alias and semantic lists (PACK_FORMAT.md §10), like
/// `packages/core/src/rerank.ts`: a linear score over eight features per candidate.
public enum Rerank {
  /// One weight per ``features(_:id:)`` value. The same as `RERANK_WEIGHTS` in packages/core,
  /// trained for EmbeddingGemma @768 with the semantic scores of core semantic-policy.ts. No
  /// feature is a usage prior.
  public static let weights: [Double] = [
    -0.334, 1.59, 1.899, 0.3387, 10.67, -7.255, 1.838, 3.632,
  ]

  public struct Input: Sendable {
    public var alias: AliasSearchOutput
    public var semantic: [SearchResult]
    /// How sure the semantic tier is, 0–1 (``Fusion/semanticConfidence(_:calibration:)``).
    public var semanticConfidence: Double

    public init(alias: AliasSearchOutput, semantic: [SearchResult], semanticConfidence: Double) {
      self.alias = alias
      self.semantic = semantic
      self.semanticConfidence = semanticConfidence
    }
  }

  /// Alias present (0/1), alias score, 1 / alias rank, alias score / alias confidence, semantic
  /// score (a candidate missing from the semantic list scores 0.02 below its lowest), best
  /// semantic score − semantic score, alias score × alias confidence, semantic score × semantic
  /// confidence.
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
      aliasScore * alias.confidence,
      score * input.semanticConfidence,
    ]
  }

  /// Fields whose match of the whole query is a curated answer.
  private static let curatedFields: Set<Field> = [.name, .shortcode, .keyword, .alias]

  /// The dictionary's answer to number slang (a query of ASCII digits only, e.g. zh "666", "88"):
  /// a confident top result whose phrase is the whole query in a curated field. The embedding
  /// model reads digits literally (6️⃣, 8️⃣); the dictionary knows the slang (👍, 👋).
  static func numberSlangAnswer(_ alias: AliasSearchOutput) -> AliasResult? {
    let groups = alias.query.split(separator: " ", omittingEmptySubsequences: false)
    let digitsOnly = groups.allSatisfy { group in
      !group.isEmpty && group.unicodeScalars.allSatisfy { $0.value >= 0x30 && $0.value <= 0x39 }
    }
    guard !alias.query.isEmpty, digitsOnly, alias.confidence >= 0.6, let top = alias.results.first,
      top.match == alias.query, curatedFields.contains(top.field)
    else { return nil }
    return top
  }

  /// Alias results ≥ 0.9 stay on top in alias order, and so does the dictionary's answer to
  /// number slang (``numberSlangAnswer(_:)``); then every other candidate of both lists by its
  /// learned score; equal scores keep alias-then-semantic order.
  public static func rerank(_ input: Input, limit: Int, weights: [Double] = weights)
    -> [SearchResult]
  {
    var pinned = input.alias.results.filter { $0.score >= 0.9 }.map(\.searchResult)
    if pinned.isEmpty, let slang = numberSlangAnswer(input.alias) {
      pinned.append(slang.searchResult)
    }
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
