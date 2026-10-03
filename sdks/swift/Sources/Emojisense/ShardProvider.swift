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
  /// Key → URL of its file, relative to this index. The files are named by their content, so they
  /// never change. Empty (older builds): `<key>.json` next to the index.
  public var files: [String: String]
  /// URL of the base layer's index for the same locale, relative to this index: synthetic
  /// queries built with the pack, asked after this layer (PACK_FORMAT.md §6).
  public var base: String?

  private enum CodingKeys: String, CodingKey {
    case format, formatVersion, packVersion, model, keys, files, base
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    format = try container.decode(String.self, forKey: .format)
    formatVersion = try container.decode(Int.self, forKey: .formatVersion)
    packVersion = try container.decode(String.self, forKey: .packVersion)
    model = try container.decode(String.self, forKey: .model)
    keys = try container.decode([String].self, forKey: .keys)
    files = try container.decodeIfPresent([String: String].self, forKey: .files) ?? [:]
    base = try container.decodeIfPresent(String.self, forKey: .base)
  }
}

/// A shard file: precomputed semantic results for frequent normalized queries.
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
/// prefix, then every further keystroke with that prefix is answered locally
/// (``peek(_:options:)``, no debounce). Unknown queries return `nil` so the next provider (the
/// API) is asked. Network errors also return `nil`.
///
/// Each locale has its own shards. English (or no locale) uses `<base>/index.json`. Another
/// locale, for example "tr", uses `<base>/tr/index.json`. The index names each key's file
/// (`files`) and, when there is one, the index of the base layer (`base`, synthetic queries
/// built with the pack). The provider asks the live layer, then the base layer. Both hold the
/// API's answers for that locale. An index without `files` (older builds) means `<key>.json`
/// next to it.
///
/// A file that does not exist (an HTTP error, or not a valid file) stays remembered: a locale
/// without shards is not asked again, and the API answers. A network error is forgotten after
/// `retryDelay`, so a later keystroke asks again, but an unreachable host is not asked on every
/// keystroke.
///
/// Shards hold the answers for normalized text. A query typed with accents, punctuation or emoji
/// ("doğum günü", "i'm done!") also returns `nil`: the API embeds it as typed.
public actor ShardProvider: SemanticProvider {
  private let base: String
  private let indexFiles: ShardFiles<ShardIndex>
  private let shardFiles: ShardFiles<Shard>

  /// - Parameters:
  ///   - baseURL: e.g. `https://cdn.emojisense.com/p/0.1.0`.
  ///   - retryDelay: After a network error, ask for that file again after this long.
  ///   - now: The clock for `retryDelay`.
  public init(
    baseURL: URL, transport: any HTTPTransport = URLSessionTransport(),
    retryDelay: TimeInterval = 10, now: @escaping @Sendable () -> Date = { Date() }
  ) {
    base = URLEncoding.trimmingTrailingSlashes(baseURL)
    indexFiles = ShardFiles(transport: transport, retryDelay: retryDelay, now: now)
    shardFiles = ShardFiles(transport: transport, retryDelay: retryDelay, now: now)
  }

  /// Uses the shards of `options.locale`.
  public func search(_ query: String, options: SemanticSearchOptions) async -> SemanticResponse? {
    guard let text = Self.shardText(query) else { return nil }
    let layers = await loadLayers(locale: options.locale)
    // Both shards load at once: a miss in the live layer does not wait for a second round trip.
    let requests = layers.map { $0.fileURL(for: text).map(shardFiles.request) }
    for (layer, request) in zip(layers, requests) {
      if let entry = await request?.value?.entries[text] {
        return Self.answer(layer.index, entry, limit: options.limit)
      }
    }
    return nil
  }

  /// From the shards that are already loaded.
  public nonisolated func peek(_ query: String, options: SemanticSearchOptions)
    -> SemanticResponse?
  {
    guard let text = Self.shardText(query) else { return nil }
    for layer in loadedLayers(locale: options.locale) {
      if let url = layer.fileURL(for: text), let entry = shardFiles.loaded(url)?.entries[text] {
        return Self.answer(layer.index, entry, limit: options.limit)
      }
    }
    return nil
  }

  /// Loads the indexes of `locale`, then the query's shard in each layer.
  public nonisolated func prefetch(_ query: String, locale: String?) {
    let text = query.isEmpty ? nil : Self.shardText(query)
    Task {
      for layer in await loadLayers(locale: locale) {
        if let text, let url = layer.fileURL(for: text) { _ = shardFiles.request(url) }
      }
    }
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

  /// A path from an index, resolved against the index's URL ("../f/a.json" from
  /// `…/p/1/tr/index.json` gives `…/p/1/f/a.json`).
  static func resolve(_ path: String, against indexURL: URL) -> URL? {
    URL(string: path, relativeTo: indexURL)?.absoluteURL
  }

  /// The text shards hold for this query. `nil` when shards cannot answer it: the query is empty,
  /// or it was typed with accents, punctuation or emoji, which the API embeds as typed (compared
  /// in UTF-16 units, like JavaScript).
  private static func shardText(_ query: String) -> String? {
    let normalized = Normalizer.normalize(query)
    if normalized.isEmpty || !Normalizer.embeddingText(query).utf16.elementsEqual(normalized.utf16) {
      return nil
    }
    return normalized
  }

  private static func answer(_ index: ShardIndex, _ entry: [Shard.Entry], limit: Int)
    -> SemanticResponse
  {
    let results = entry.prefix(max(0, limit)).map {
      SearchResult(emoji: $0.emoji, id: $0.id, score: $0.score, source: .semantic)
    }
    return SemanticResponse(
      results: results, packVersion: index.packVersion, model: index.model, cached: true,
      layer: .shard)
  }

  /// English shards stay at the root, so old clients keep them. Other locales have a folder.
  private nonisolated func liveIndexURL(locale: String?) -> URL? {
    let locale = Self.shardLocale(locale)
    let folder = locale == "en" ? "" : "\(URLEncoding.uriComponent(locale))/"
    return URL(string: "\(base)/\(folder)index.json")
  }

  /// The live layer, then the base layer it names; both indexes loaded if needed.
  private func loadLayers(locale: String?) async -> [ShardLayer] {
    guard let liveURL = liveIndexURL(locale: locale), let live = await indexFiles.load(liveURL)
    else { return [] }
    let layer = ShardLayer(url: liveURL, index: live)
    guard let baseURL = layer.baseURL, let base = await indexFiles.load(baseURL) else {
      return [layer]
    }
    return [layer, ShardLayer(url: baseURL, index: base)]
  }

  /// The layers whose indexes are already in memory, for `peek`.
  private nonisolated func loadedLayers(locale: String?) -> [ShardLayer] {
    guard let liveURL = liveIndexURL(locale: locale), let live = indexFiles.loaded(liveURL) else {
      return []
    }
    let layer = ShardLayer(url: liveURL, index: live)
    guard let baseURL = layer.baseURL, let base = indexFiles.loaded(baseURL) else {
      return [layer]
    }
    return [layer, ShardLayer(url: baseURL, index: base)]
  }
}

/// One layer of a locale's shards: an index and its URL, which its paths are relative to.
private struct ShardLayer: Sendable {
  let url: URL
  let index: ShardIndex

  /// The base index that this (live) index names.
  var baseURL: URL? {
    index.base.flatMap { ShardProvider.resolve($0, against: url) }
  }

  /// The file of the query's shard. `nil` when no key matches.
  func fileURL(for text: String) -> URL? {
    guard let key = ShardProvider.shardKey(for: text, keys: index.keys) else { return nil }
    return ShardProvider.resolve(index.files[key] ?? "\(URLEncoding.uriComponent(key)).json", against: url)
  }
}

/// Static files by URL, each asked for once. A file that arrived or does not exist stays
/// remembered. After a network error, the file is asked for again once `retryDelay` has passed.
private final class ShardFiles<Value: Decodable & Sendable>: Sendable {
  /// A file that is settled or on its way.
  enum Request: Sendable {
    case settled(Value?)
    case pending(Task<Value?, Never>)

    var value: Value? {
      get async {
        switch self {
        case .settled(let value): value
        case .pending(let task): await task.value
        }
      }
    }
  }

  private enum State {
    case loading(Task<Value?, Never>)
    case arrived(Value)
    /// An HTTP error, or a body that is not a valid file (e.g. an error page served as 200).
    case missing
    case unreachable(until: Date)
  }

  private let transport: any HTTPTransport
  private let retryDelay: TimeInterval
  private let now: @Sendable () -> Date
  /// Keyed by absolute URL.
  private let states = Locked<[String: State]>([:])

  init(transport: any HTTPTransport, retryDelay: TimeInterval, now: @escaping @Sendable () -> Date) {
    self.transport = transport
    self.retryDelay = retryDelay
    self.now = now
  }

  /// The file, loaded if needed. `nil`: it does not exist, or the host cannot be reached now.
  func load(_ url: URL) async -> Value? {
    await request(url).value
  }

  /// The file, starting its request if needed.
  func request(_ url: URL) -> Request {
    let key = url.absoluteString
    return states.withLock { states in
      switch states[key] {
      case .arrived(let value): return .settled(value)
      case .missing: return .settled(nil)
      case .unreachable(let until) where now() < until: return .settled(nil)
      case .loading(let task): return .pending(task)
      case .unreachable, nil:
        // The task settles under the same lock, so it cannot settle before this line.
        let task = Task { await self.fetch(url) }
        states[key] = .loading(task)
        return .pending(task)
      }
    }
  }

  /// The file if it has arrived. Never starts a request.
  func loaded(_ url: URL) -> Value? {
    states.withLock { states in
      if case .arrived(let value) = states[url.absoluteString] { value } else { nil }
    }
  }

  private func fetch(_ url: URL) async -> Value? {
    let state: State
    do {
      let response = try await transport.get(url)
      if response.isSuccess, let value = try? JSONDecoder().decode(Value.self, from: response.body)
      {
        state = .arrived(value)
      } else {
        state = .missing
      }
    } catch {
      state = .unreachable(until: now().addingTimeInterval(retryDelay))
    }
    states.withLock { $0[url.absoluteString] = state }
    if case .arrived(let value) = state { return value }
    return nil
  }
}
