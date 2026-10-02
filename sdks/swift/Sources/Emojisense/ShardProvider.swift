import Foundation

/// `<base>/index.json` (or `<base>/<locale>/index.json`): which prefix keys exist (adaptive: hot
/// prefixes get longer keys).
public struct ShardIndex: Codable, Sendable {
  public var format: String
  public var formatVersion: Int
  public var packVersion: String
  /// e.g. "embeddinggemma@256". Results are valid only for this model.
  public var model: String
  /// Sorted shard keys. A query uses the longest key that is a prefix of it.
  public var keys: [String]
}

/// `<base>/<key>.json` (or `<base>/<locale>/<key>.json`): precomputed semantic results for
/// frequent normalized queries.
public struct Shard: Decodable, Sendable {
  public struct Entry: Decodable, Sendable {
    public var emoji: String
    public var id: String
    public var score: Double

    /// Stored as `[emoji, hexcode, score]`.
    public init(from decoder: any Decoder) throws {
      var container = try decoder.unkeyedContainer()
      emoji = try container.decode(String.self)
      id = try container.decode(String.self)
      score = try container.decode(Double.self)
    }
  }

  public var key: String
  /// Normalized query → results, best first.
  public var entries: [String: [Entry]]
}

/// Layer 2 (PACK_FORMAT.md §6): precomputed results served as static files. One download per
/// prefix, then every further keystroke with that prefix is answered locally. Unknown queries
/// return `nil` so the next provider (the API) is asked. Network errors also return `nil`.
///
/// Each locale has its own shards. English (or no locale) uses `<base>/index.json` and
/// `<base>/<key>.json`. Another locale, for example "tr", uses `<base>/tr/index.json` and
/// `<base>/tr/<key>.json`. These hold the API's answers for that locale. When a locale has no
/// index (HTTP 404 or a network error), the provider returns `nil` for that locale for as long as
/// it exists, and the API answers.
public actor ShardProvider: SemanticProvider {
  private let base: String
  private let transport: any HTTPTransport
  /// Keyed by the normalized locale ("en" for `nil`).
  private var indexes: [String: Task<ShardIndex?, Never>] = [:]
  private var shards: [String: [String: Task<Shard?, Never>]] = [:]

  /// - Parameter baseURL: e.g. `https://api.emojisense.com/p/0.1.0`.
  public init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
    base = URLEncoding.trimmingTrailingSlashes(baseURL)
    self.transport = transport
  }

  /// Uses the shards of `options.locale`.
  public func search(_ query: String, options: SemanticSearchOptions) async -> SemanticResponse? {
    let normalized = Normalizer.normalize(query)
    if normalized.isEmpty { return nil }
    // Shards hold the answers for normalized text. Text typed with accents, punctuation or emoji
    // goes to the API, which embeds it as typed (compared in UTF-16 units, like JavaScript).
    if !Normalizer.embeddingText(query).utf16.elementsEqual(normalized.utf16) { return nil }
    let locale = Self.shardLocale(options.locale)
    guard let loaded = await loadIndex(locale: locale),
      let key = Self.shardKey(for: normalized, keys: loaded.keys),
      let entry = await loadShard(key: key, locale: locale)?.entries[normalized]
    else { return nil }

    let results = entry.prefix(max(0, options.limit)).map {
      SearchResult(emoji: $0.emoji, id: $0.id, score: $0.score, source: .semantic)
    }
    return SemanticResponse(
      results: results, packVersion: loaded.packVersion, model: loaded.model, cached: true,
      layer: .shard)
  }

  /// The longest key that is a prefix of the normalized query (compared in UTF-16 code units).
  public static func shardKey(for query: String, keys: [String]) -> String? {
    var best: String?
    for key in keys where query.utf16.starts(with: key.utf16) {
      if best.map({ key.utf16.count > $0.utf16.count }) ?? true { best = key }
    }
    return best
  }

  /// The language subtag in lowercase, like the API's `locale` ("pt-BR" gives "pt"). `nil` and
  /// "" give "en".
  static func shardLocale(_ locale: String?) -> String {
    let language = (locale ?? "").lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first
    return language.map(String.init) ?? "en"
  }

  /// English shards stay at the root, so old clients keep them. Other locales have a folder.
  private static func folder(for locale: String) -> String {
    locale == "en" ? "" : "\(URLEncoding.uriComponent(locale))/"
  }

  private func loadIndex(locale: String) async -> ShardIndex? {
    let task =
      indexes[locale] ?? fetch(ShardIndex.self, path: "\(Self.folder(for: locale))index.json")
    indexes[locale] = task
    return await task.value
  }

  private func loadShard(key: String, locale: String) async -> Shard? {
    let path = "\(Self.folder(for: locale))\(URLEncoding.uriComponent(key)).json"
    let task = shards[locale]?[key] ?? fetch(Shard.self, path: path)
    shards[locale, default: [:]][key] = task
    return await task.value
  }

  private func fetch<T: Decodable & Sendable>(_ type: T.Type, path: String) -> Task<T?, Never> {
    let transport = transport
    let address = "\(base)/\(path)"
    return Task {
      guard let url = URL(string: address),
        let response = try? await transport.get(url), response.isSuccess
      else { return nil }
      return try? JSONDecoder().decode(type, from: response.body)
    }
  }
}
