/// How well the tiers understood a query.
public struct QueryConfidence: Equatable, Sendable {
  /// 0–1, rounded to 3 decimals: how well the best tier understood the query.
  public var confidence: Double
  /// No tier understood the query: the dictionary does not cover its words and the semantic list
  /// is flat or low. Show the results as guesses; the server asks its concept tier.
  public var unsure: Bool

  public init(confidence: Double, unsure: Bool) {
    self.confidence = confidence
    self.unsure = unsure
  }
}

/// The unsure verdict and the concept merge, like `packages/core/src/confidence.ts`.
/// Thresholds: DECISIONS.md, "Unsure queries and the concept tier".
public enum Confidence {
  /// At or above this ``AliasSearchOutput/coverage`` the alias dictionary explains the whole
  /// query.
  public static let wholeCoverage = 0.85
  /// Below this semantic strength the semantic list is flat or low: the model matched the query
  /// to nothing in particular ("kendrick lamar" → 🦁 🤦 🧙‍♂️ at cosines 0.38–0.40).
  public static let semanticSure = 0.6
  /// The alias tier is unsure below this top score (as in ``Fusion/shouldUseSemantic(_:)``).
  static let aliasSure = 0.6
  /// Results 2–5, whose mean the top cosine must clear to stand out.
  private static let spreadRanks = 5
  /// A top cosine this far above the next ones counts as a full calibration step.
  private static let spreadFull = 0.06

  /// How strong a semantic list is, 0–1, from its final scores: the best cosine on the
  /// calibrated scale, scaled down when the top does not stand out from results 2–5. Concept
  /// results (`source == .concept`) are not semantic evidence and are skipped.
  public static func semanticStrength(
    _ semantic: [SearchResult], calibration: Fusion.SemanticCalibration = .standard
  ) -> Double {
    let scores = semantic.filter { $0.source != .concept }.map(\.score)
    let top = scores.first ?? 0
    let level = min(
      1, max(0, (top - calibration.floor) / (calibration.ceiling - calibration.floor)))
    let next = scores.dropFirst().prefix(spreadRanks - 1)
    if next.isEmpty { return level }
    let mean = next.reduce(0, +) / Double(next.count)
    let spread = min(1, max(0, (top - mean) / spreadFull))
    // A flat top (nothing stands out) halves the strength; a clear one keeps it.
    return level * (0.5 + 0.5 * spread)
  }

  /// The dictionary explains the whole query with confidence: one phrase matches all its words
  /// (`coverage` ≥ ``wholeCoverage``) and the top result scores ≥ 0.6. A whole match in a weak
  /// field ("drake" → 🦆 by a keyword, 0.58) is not enough on its own.
  public static func aliasCovers(_ alias: AliasSearchOutput) -> Bool {
    alias.coverage >= wholeCoverage && alias.confidence >= aliasSure
  }

  /// Is a query unsure? Yes when the dictionary does not cover it (``aliasCovers(_:)``) and the
  /// semantic list is flat or low (``semanticStrength(_:calibration:)`` < ``semanticSure``).
  /// Without a semantic list (not asked, offline, over the limit), when the dictionary does not
  /// cover it. An empty query is never unsure.
  public static func assess(
    alias: AliasSearchOutput?, semantic: [SearchResult]?,
    calibration: Fusion.SemanticCalibration = .standard
  ) -> QueryConfidence {
    if let alias, alias.tokens.isEmpty { return QueryConfidence(confidence: 0, unsure: false) }
    let aliasPart = alias.map { $0.confidence * min(1, $0.coverage / wholeCoverage) } ?? 0
    let covered = alias.map(aliasCovers) ?? false
    guard let semantic else {
      return QueryConfidence(confidence: rounded(aliasPart), unsure: alias != nil && !covered)
    }
    let strength = semanticStrength(semantic, calibration: calibration)
    return QueryConfidence(
      confidence: rounded(max(aliasPart, strength)), unsure: !covered && strength < semanticSure)
  }

  /// Concept results (`source == .concept`) go after the confident alias hits (the dictionary
  /// covers the query and the hit scores ≥ 0.6) and before every other result. Duplicates keep
  /// their first place.
  public static func mergeConcept(
    _ results: [SearchResult], concept: [SearchResult], alias: AliasSearchOutput?,
    limit: Int = 24
  ) -> [SearchResult] {
    if concept.isEmpty { return Array(results.prefix(max(0, limit))) }
    let confident: Set<String> =
      if let alias, aliasCovers(alias) {
        Set(alias.results.filter { $0.score >= aliasSure }.map(\.id))
      } else {
        []
      }
    let head = results.filter { confident.contains($0.id) }
    var seen: Set<String> = []
    var merged: [SearchResult] = []
    for result in head + concept + results where seen.insert(result.id).inserted {
      merged.append(result)
    }
    return Array(merged.prefix(max(0, limit)))
  }

  private static func rounded(_ value: Double) -> Double {
    (value * 1000).rounded() / 1000
  }
}
