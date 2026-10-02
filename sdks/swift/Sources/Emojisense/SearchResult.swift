public enum ResultSource: String, Codable, Sendable {
  case alias
  case semantic
  case custom
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

  public init(
    emoji: String, id: String, score: Double, source: ResultSource,
    imageUrl: String? = nil, shortcode: String? = nil
  ) {
    self.emoji = emoji
    self.id = id
    self.score = score
    self.source = source
    self.imageUrl = imageUrl
    self.shortcode = shortcode
  }
}

/// A Tier 0 (alias dictionary) result.
public struct AliasResult: Hashable, Sendable {
  public var emoji: String
  public var id: String
  /// 0–1, rounded to 3 decimals.
  public var score: Double
  /// Display label in the requested locale, else in the primary pack locale.
  public var label: String
  /// The phrase that matched best, for debugging and "why this result" UI.
  public var match: String
  public var field: Field

  public var searchResult: SearchResult {
    SearchResult(emoji: emoji, id: id, score: score, source: .alias)
  }
}

public struct AliasSearchOutput: Sendable {
  /// The normalized query that was searched.
  public var query: String
  public var tokens: [String]
  public var results: [AliasResult]
  /// Score of the best result, 0 when there is none.
  public var confidence: Double
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
