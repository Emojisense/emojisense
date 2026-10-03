import Foundation

/// The kind of a culture entry (PACK_FORMAT.md §9).
public enum CultureKind: String, Hashable, Sendable {
  /// Always active: a lasting association ("greatest of all time" → ⚽).
  case lasting
  /// Active in a window that repeats every year (Halloween).
  case seasonal
  /// Active in one dated window (a tournament, a festival on a lunar calendar).
  case event
  /// A word whose main sense differs by region ("football" is ⚽ outside North America). It is
  /// the only kind that may put its emoji first, and only under the rules of
  /// ``CultureLayer/matchRegionalLead(_:query:canonicalTopId:region:now:day:)``. Everywhere else
  /// it adds after the top result like a lasting entry.
  case regional
}

/// Inclusive days: "MM-DD" with `recurs == "yearly"` (the window may wrap the year end), else
/// "YYYY-MM-DD". A festival on a lunar calendar is one dated entry per year (`diwali-2026`).
public struct CultureWindow: Hashable, Sendable, Decodable {
  public var from: String
  public var to: String
  /// "yearly", or `nil` for a dated window. Another value counts as a dated window.
  public var recurs: String?

  public var isYearly: Bool { recurs == "yearly" }

  public init(from: String, to: String, recurs: String? = nil) {
    self.from = from
    self.to = to
    self.recurs = recurs
  }
}

/// One emoji of a culture entry. Stored as `[emoji, hexcode, weight]`, weight 0–1.
public struct CultureEmoji: Hashable, Sendable, Decodable {
  public var emoji: String
  public var hexcode: String
  public var weight: Double

  public init(emoji: String, hexcode: String, weight: Double) {
    self.emoji = emoji
    self.hexcode = hexcode
    self.weight = weight
  }

  public init(from decoder: any Decoder) throws {
    var item = try decoder.unkeyedContainer()
    guard let emoji = try? item.decode(String.self), let hexcode = try? item.decode(String.self),
      let weight = try? item.decode(Double.self)
    else {
      throw EmojisenseError.invalidData("a culture emoji must be [emoji, hexcode, weight]")
    }
    self.init(emoji: emoji, hexcode: hexcode, weight: weight)
  }
}

public struct CultureEntry: Hashable, Sendable {
  public var id: String
  public var kind: CultureKind
  /// Why these emoji fit, in the file's locale. Neutral, short.
  public var context: String
  /// `nil` = always (lasting and regional entries).
  public var when: CultureWindow?
  /// ISO 3166-1 alpha-2 codes, or `["*"]` for every region.
  public var regions: [String]
  /// With `regions == ["*"]`: the regions where the entry does not apply when the app names one.
  public var exceptRegions: [String]
  /// Normalized phrases (PACK_FORMAT.md §3) that people of this locale type.
  public var triggers: [String]
  /// Strongest first.
  public var emoji: [CultureEmoji]
  /// May appear on a "relevant now" shelf (seasonal and event entries only).
  public var featured: Bool
  /// Regional entries only: hexcodes of the canonical top answers this regional sense may move
  /// to second place (the other region's reading of the same word, e.g. 🏈 for "football").
  public var outranks: [String]

  public init(
    id: String, kind: CultureKind = .lasting, context: String = "", when: CultureWindow? = nil,
    regions: [String] = ["*"], exceptRegions: [String] = [], triggers: [String] = [],
    emoji: [CultureEmoji] = [], featured: Bool = false, outranks: [String] = []
  ) {
    self.id = id
    self.kind = kind
    self.context = context
    self.when = when
    self.regions = regions
    self.exceptRegions = exceptRegions
    self.triggers = triggers
    self.emoji = emoji
    self.featured = featured
    self.outranks = outranks
  }
}

extension CultureEntry: Decodable {
  private enum CodingKeys: String, CodingKey {
    case id, kind, context, when, regions, exceptRegions, triggers, emoji, featured, outranks
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decodeIfPresent(String.self, forKey: .kind)
    self.init(
      id: try container.decode(String.self, forKey: .id),
      // A kind this SDK does not know acts as a lasting entry: it adds after the top result.
      kind: kind.flatMap(CultureKind.init(rawValue:)) ?? .lasting,
      context: try container.decodeIfPresent(String.self, forKey: .context) ?? "",
      when: try container.decodeIfPresent(CultureWindow.self, forKey: .when),
      regions: try container.decodeIfPresent([String].self, forKey: .regions) ?? [],
      exceptRegions: try container.decodeIfPresent([String].self, forKey: .exceptRegions) ?? [],
      triggers: try container.decodeIfPresent([String].self, forKey: .triggers) ?? [],
      emoji: try container.decodeIfPresent([CultureEmoji].self, forKey: .emoji) ?? [],
      featured: try container.decodeIfPresent(Bool.self, forKey: .featured) ?? false,
      outranks: try container.decodeIfPresent([String].self, forKey: .outranks) ?? [])
  }
}

/// One locale's culture file, `culture.<locale>.json` (PACK_FORMAT.md §9). Load it with
/// ``CultureLayer/loadCulture(baseURL:locale:transport:)`` and give it to
/// ``AliasEngine/withCulture(_:)``.
public struct Culture: Hashable, Sendable {
  public static let format = "emojisense-culture"
  public static let formatVersion = 1

  public var packVersion: String
  public var locale: String
  /// Days the build covered (YYYY-MM-DD): every lasting and regional entry, plus the seasonal and
  /// event entries active on any day of [`from`, `until`]. Builds cover at least 12 months, so a
  /// client checks each entry's window against its own day and needs no new file every day.
  public var from: String
  public var until: String
  public var entries: [CultureEntry]
  /// Ids of the featured entries active on `from`, for clients that do not check windows. Files
  /// that cover 12 months hold none: use
  /// ``CultureLayer/relevantNow(_:locale:region:now:day:limit:)``, which checks the windows on
  /// the device.
  public var relevantNow: [String]
  /// IANA time zone → ISO 3166-1 alpha-2 region, for the regions that entries name. A device
  /// whose locale has no region finds its region from its time zone
  /// (``CultureLayer/deviceRegion(zones:locale:timeZone:)``).
  public var zones: [String: String]?

  public init(
    packVersion: String, locale: String, from: String, until: String, entries: [CultureEntry],
    relevantNow: [String] = [], zones: [String: String]? = nil
  ) {
    self.packVersion = packVersion
    self.locale = locale
    self.from = from
    self.until = until
    self.entries = entries
    self.relevantNow = relevantNow
    self.zones = zones
  }

  /// Decodes and validates a culture file. Throws ``EmojisenseError`` for another format or
  /// version, or for content that is not a culture file.
  public init(jsonData: Data) throws {
    do {
      self = try JSONDecoder().decode(Culture.self, from: jsonData)
    } catch let error as EmojisenseError {
      throw error
    } catch {
      throw EmojisenseError.invalidData("not a valid culture file (\(error))")
    }
  }
}

extension Culture: Decodable {
  private enum CodingKeys: String, CodingKey {
    case format, formatVersion, packVersion, locale, from, until, entries, relevantNow, zones
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let format = (try? container.decodeIfPresent(String.self, forKey: .format)) ?? nil
    guard format == Self.format else {
      throw EmojisenseError.invalidFormat(expected: Self.format, found: format)
    }
    let version = (try? container.decodeIfPresent(Int.self, forKey: .formatVersion)) ?? nil
    guard version == Self.formatVersion else {
      throw EmojisenseError.unsupportedFormatVersion(format: Self.format, version: version ?? 0)
    }
    guard container.contains(.entries), try !container.decodeNil(forKey: .entries) else {
      throw EmojisenseError.invalidData("culture file has no entries")
    }
    let entries = try container.decode([CultureEntry].self, forKey: .entries)
    self.init(
      packVersion: try container.decodeIfPresent(String.self, forKey: .packVersion) ?? "",
      locale: try container.decodeIfPresent(String.self, forKey: .locale) ?? "",
      from: try container.decodeIfPresent(String.self, forKey: .from) ?? "",
      until: try container.decodeIfPresent(String.self, forKey: .until) ?? "",
      entries: entries,
      relevantNow: try container.decodeIfPresent([String].self, forKey: .relevantNow) ?? [],
      zones: try container.decodeIfPresent([String: String].self, forKey: .zones))
  }
}

/// An emoji the culture layer adds next to the canonical answer (PACK_FORMAT.md §9).
public struct CultureResult: Hashable, Sendable {
  public var emoji: String
  public var id: String
  /// The entry's weight × how well the query hits its trigger, rounded to 3 decimals.
  public var score: Double
  /// The reason, in the culture file's locale.
  public var context: String
  public var cultureId: String
  /// The trigger that matched.
  public var match: String
  /// Display label from the engine; empty without one.
  public var label: String

  public var source: ResultSource { .culture }

  public init(
    emoji: String, id: String, score: Double, context: String, cultureId: String, match: String,
    label: String = ""
  ) {
    self.emoji = emoji
    self.id = id
    self.score = score
    self.context = context
    self.cultureId = cultureId
    self.match = match
    self.label = label
  }
}

/// A result type that the culture layer can add its results to:
/// ``CultureLayer/insertCulture(_:matches:limit:lead:)`` and
/// ``CultureLayer/applyCulture(_:culture:query:region:now:day:prefix:text:limit:engine:locale:)``
/// keep the list's element type.
public protocol CultureInsertable: Sendable {
  var id: String { get }
  init(culture: CultureResult)
}

extension CultureResult: CultureInsertable {
  public init(culture: CultureResult) {
    self = culture
  }
}

extension AliasResult: CultureInsertable {
  public init(culture: CultureResult) {
    self.init(
      emoji: culture.emoji, id: culture.id, score: culture.score, label: culture.label,
      match: culture.match, field: .culture, source: .culture, context: culture.context,
      cultureId: culture.cultureId)
  }
}

extension SearchResult: CultureInsertable {
  public init(culture: CultureResult) {
    self.init(
      emoji: culture.emoji, id: culture.id, score: culture.score, source: .culture,
      context: culture.context, cultureId: culture.cultureId)
  }
}

/// One emoji of the "relevant now" shelf.
public struct RelevantEmoji: Hashable, Sendable {
  public var emoji: String
  public var hexcode: String
  public var context: String
  public var cultureId: String
}
