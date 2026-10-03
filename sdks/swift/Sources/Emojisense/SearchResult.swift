public enum ResultSource: String, Codable, Sendable {
  case alias
  case semantic
  case custom
  /// An editorial association of the culture layer (``CultureResult``).
  case culture
}

/// One ranked emoji from any tier.
public struct SearchResult: Hashable, Codable, Sendable {
  /// The emoji character, or `:shortcode:` for a custom emoji.
  public var emoji: String
  /// Emojibase hexcode of the base emoji, e.g. "1F44D"; `C-<emojiId>` for a custom emoji.
  public var id: String
  /// 0–1. Comparable within one source only.
  public var score: Double
  public var source: ResultSource
  /// Custom emoji only (`source == .custom`): the image to draw instead of a font glyph.
  public var imageUrl: String?
  /// Custom emoji only: the shortcode without colons, e.g. "party_parrot".
  public var shortcode: String?
  /// Culture results only (`source == .culture`): why the emoji fits, in the culture file's
  /// locale.
  public var context: String?
  /// Culture results only: the id of the culture entry that added the emoji.
  public var cultureId: String?

  public init(
    emoji: String, id: String, score: Double, source: ResultSource,
    imageUrl: String? = nil, shortcode: String? = nil, context: String? = nil,
    cultureId: String? = nil
  ) {
    self.emoji = emoji
    self.id = id
    self.score = score
    self.source = source
    self.imageUrl = imageUrl
    self.shortcode = shortcode
    self.context = context
    self.cultureId = cultureId
  }
}

/// A Tier 0 (alias dictionary) result. With a culture file (``AliasEngine/culture``), the list
/// of ``AliasEngine/search(_:options:)`` also holds the culture layer's results in this shape:
/// `source == .culture`, `field == .culture`, and `context` and `cultureId` set, as in
/// packages/core.
public struct AliasResult: Hashable, Sendable {
  public var emoji: String
  public var id: String
  /// 0–1, rounded to 3 decimals.
  public var score: Double
  /// Display label in the requested locale, else in the primary pack locale.
  public var label: String
  /// The phrase that matched best (for a culture result, the trigger), for debugging and
  /// "why this result" UI.
  public var match: String
  public var field: Field
  /// ``ResultSource/alias``, or ``ResultSource/culture`` for an emoji the culture layer added.
  public var source: ResultSource = .alias
  /// Culture results only: why the emoji fits, in the culture file's locale.
  public var context: String?
  /// Culture results only: the id of the culture entry that added the emoji.
  public var cultureId: String?

  public var searchResult: SearchResult {
    SearchResult(
      emoji: emoji, id: id, score: score, source: source, context: context, cultureId: cultureId)
  }
}

public struct AliasSearchOutput: Sendable {
  /// The normalized query that was searched.
  public var query: String
  public var tokens: [String]
  /// The canonical ranking, plus culture results after its top result when the engine has a
  /// culture file (``AliasEngine/canonicalSearch(_:options:)`` gives the canonical ranking
  /// only).
  public var results: [AliasResult]
  /// Score of the best canonical result, 0 when there is none.
  public var confidence: Double
  /// 0–1, rounded to 3 decimals: the largest IDF-weighted share of the query that one phrase
  /// matches with whole tokens (exact, a typo of the token, or a completion of the token being
  /// typed into a word of the preferred locale). A prefix completion into another locale's word
  /// is a partial match and does not count. Below ``Confidence/wholeCoverage`` the dictionary
  /// does not explain the query (PACK_FORMAT.md §4).
  public var coverage: Double = 0
}

public struct EmojiEntry: Hashable, Sendable {
  public let emoji: String
  public let id: String
  public let group: String
  public let version: Double
  public let hasSkinTones: Bool
  /// Display label per loaded locale.
  public internal(set) var labels: [String: String]
}
