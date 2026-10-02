import Foundation

/// Search fields of a pack row, strongest first (PACK_FORMAT.md §2).
public enum Field: String, CaseIterable, Codable, Sendable {
  /// The normalized display label. Derived, not stored.
  case name
  case shortcode
  case keyword
  case alias
  case typo
  case low

  public var defaultWeight: Double {
    switch self {
    case .name: 1
    case .shortcode: 0.95
    case .keyword: 0.85
    case .alias: 0.8
    case .typo: 0.75
    case .low: 0.55
    }
  }
}

/// One emoji of a pack: an 11-position JSON array.
public struct PackRow: Hashable, Sendable {
  public var emoji: String
  /// Emojibase hexcode of the base emoji, e.g. "1F44D". The stable id.
  public var hexcode: String
  /// Index into ``Pack/groups``.
  public var group: Int
  /// Emoji version that introduced it, e.g. 15.1.
  public var version: Double
  public var hasSkinTones: Bool
  /// Display label in the pack locale. Not normalized; empty in extension parts.
  public var label: String
  /// `|`-joined normalized phrases per field, for every field except ``Field/name``.
  public var shortcode: String
  public var keyword: String
  public var alias: String
  public var typo: String
  public var low: String

  public init(
    emoji: String, hexcode: String, group: Int = 0, version: Double = 1,
    hasSkinTones: Bool = false, label: String, shortcode: String = "", keyword: String = "",
    alias: String = "", typo: String = "", low: String = ""
  ) {
    self.emoji = emoji
    self.hexcode = hexcode
    self.group = group
    self.version = version
    self.hasSkinTones = hasSkinTones
    self.label = label
    self.shortcode = shortcode
    self.keyword = keyword
    self.alias = alias
    self.typo = typo
    self.low = low
  }

  /// The stored phrases of a field. ``Field/name`` is derived from ``label`` and returns "".
  public func phrases(for field: Field) -> String {
    switch field {
    case .name: ""
    case .shortcode: shortcode
    case .keyword: keyword
    case .alias: alias
    case .typo: typo
    case .low: low
    }
  }
}

extension PackRow: Codable {
  public init(from decoder: any Decoder) throws {
    var row = try decoder.unkeyedContainer()
    emoji = try row.decode(String.self)
    hexcode = try row.decode(String.self)
    group = try row.decode(Int.self)
    version = try row.decode(Double.self)
    hasSkinTones = try row.decode(Int.self) == 1
    label = try row.decode(String.self)
    shortcode = try row.decode(String.self)
    keyword = try row.decode(String.self)
    alias = try row.decode(String.self)
    typo = try row.decode(String.self)
    low = try row.decode(String.self)
  }

  public func encode(to encoder: any Encoder) throws {
    var row = encoder.unkeyedContainer()
    try row.encode(emoji)
    try row.encode(hexcode)
    try row.encode(group)
    try row.encode(version)
    try row.encode(hasSkinTones ? 1 : 0)
    for value in [label, shortcode, keyword, alias, typo, low] { try row.encode(value) }
  }
}

/// A client data pack, format v1 (`pack.<locale>.json` or `pack.<locale>.ext.json`).
public struct Pack: Sendable {
  public static let format = "emojisense-pack"
  public static let formatVersion = 1

  /// `core` renders first; `ext` holds the remaining aliases, typos and low-confidence phrases.
  public enum Part: String, Codable, Sendable {
    case core
    case ext
  }

  public var packVersion: String
  public var locale: String
  public var part: Part
  public var emojiVersion: String
  public var groups: [String]
  /// Field weight overrides. Fields without an entry use ``Field/defaultWeight``.
  public var weights: [Field: Double]
  /// How often people use each row's emoji, percentile 0–100 (0 = unknown), in row order. English
  /// core pack only; it breaks alias score ties and feeds fusion (PACK_FORMAT.md §2).
  public var popularity: [Int]?
  public var emoji: [PackRow]

  public init(
    packVersion: String, locale: String, part: Part = .core, emojiVersion: String,
    groups: [String], weights: [Field: Double] = [:], popularity: [Int]? = nil, emoji: [PackRow]
  ) {
    self.packVersion = packVersion
    self.locale = locale
    self.part = part
    self.emojiVersion = emojiVersion
    self.groups = groups
    self.weights = weights
    self.popularity = popularity
    self.emoji = emoji
  }

  /// Decodes and validates a pack file. Throws for another `format` or `formatVersion`.
  public init(jsonData: Data) throws {
    self = try JSONDecoder().decode(Pack.self, from: jsonData)
  }

  public func weight(for field: Field) -> Double {
    weights[field] ?? field.defaultWeight
  }
}

extension Pack: Decodable {
  private enum CodingKeys: String, CodingKey {
    case format, formatVersion, packVersion, locale, part, emojiVersion, groups, weights,
      popularity, emoji
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let format = try container.decodeIfPresent(String.self, forKey: .format)
    guard format == Self.format else {
      throw EmojisenseError.invalidFormat(expected: Self.format, found: format)
    }
    let version = try container.decode(Int.self, forKey: .formatVersion)
    guard version == Self.formatVersion else {
      throw EmojisenseError.unsupportedFormatVersion(format: Self.format, version: version)
    }
    packVersion = try container.decode(String.self, forKey: .packVersion)
    locale = try container.decode(String.self, forKey: .locale)
    part = try container.decodeIfPresent(Part.self, forKey: .part) ?? .core
    emojiVersion = try container.decode(String.self, forKey: .emojiVersion)
    groups = try container.decode([String].self, forKey: .groups)
    let rawWeights = try container.decodeIfPresent([String: Double].self, forKey: .weights) ?? [:]
    weights = Dictionary(
      uniqueKeysWithValues: rawWeights.compactMap { key, value in
        Field(rawValue: key).map { ($0, value) }
      })
    popularity = try container.decodeIfPresent([Int].self, forKey: .popularity)
    emoji = try container.decode([PackRow].self, forKey: .emoji)
  }
}
