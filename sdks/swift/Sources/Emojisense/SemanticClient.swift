import Foundation

/// The HTTP API as a semantic provider (layer `api`): `GET /v1/search?mode=semantic`.
///
/// Over its plan limit the API still answers from its shared cache. For other queries it answers
/// `overLimit: true`, and search continues on the alias dictionary and shards. Never a hard failure.
public actor SemanticClient: SemanticProvider {
  public struct Configuration: Sendable {
    /// Base URL of the Emojisense API, e.g. `https://api.emojisense.com`.
    public var endpoint: URL
    /// Publishable key (`pk_…`), sent as the `key` query parameter.
    public var key: String?
    /// Pin a data pack version so results match the client's alias pack.
    public var packVersion: String?
    /// In-memory LRU of recent responses.
    public var cacheSize: Int
    /// After an over-limit answer, skip the API for this long. Default 0: keep asking, because
    /// the edge still answers queries that are in its shared cache. Over-limit misses are remembered.
    public var overLimitCooldown: TimeInterval

    public init(
      endpoint: URL, key: String? = nil, packVersion: String? = nil, cacheSize: Int = 200,
      overLimitCooldown: TimeInterval = 0
    ) {
      self.endpoint = endpoint
      self.key = key
      self.packVersion = packVersion
      self.cacheSize = cacheSize
      self.overLimitCooldown = overLimitCooldown
    }
  }

  /// Recent responses and the end of an over-limit pause.
  private struct Memory {
    var cache: LRUCache<String, SemanticResponse>
    var pausedUntil = Date.distantPast
  }

  private let configuration: Configuration
  private let transport: any HTTPTransport
  private let now: @Sendable () -> Date
  /// In a lock, so that ``peek(_:options:)`` reads it without waiting for the actor.
  private let memory: Locked<Memory>

  public init(
    configuration: Configuration, transport: any HTTPTransport = URLSessionTransport(),
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.configuration = configuration
    self.transport = transport
    self.now = now
    memory = Locked(Memory(cache: LRUCache(capacity: configuration.cacheSize)))
  }

  /// Returns `nil` for an empty query and while paused after an over-limit answer.
  /// Throws ``EmojisenseError/httpStatus(_:url:)`` for HTTP errors.
  public func search(_ query: String, options: SemanticSearchOptions) async throws
    -> SemanticResponse?
  {
    guard let url = try requestURL(query: query, options: options) else { return nil }
    let key = url.absoluteString
    if let hit = memory.withLock({ $0.cache.value(forKey: key) }) { return Self.remembered(hit) }

    let response = try await transport.get(url)
    guard response.isSuccess else { throw EmojisenseError.httpStatus(response.status, url: url) }
    var body = try JSONDecoder().decode(SemanticResponse.self, from: response.body)
    body.layer = .api
    let pausedUntil = now().addingTimeInterval(configuration.overLimitCooldown)
    memory.withLock { memory in
      memory.cache.insert(body, forKey: key)
      if body.overLimit { memory.pausedUntil = pausedUntil }
    }
    return body.overLimit ? nil : body
  }

  /// A response this client received before for the same request. Never an over-limit answer.
  public nonisolated func peek(_ query: String, options: SemanticSearchOptions)
    -> SemanticResponse?
  {
    guard let url = try? requestURL(query: query, options: options) else { return nil }
    let key = url.absoluteString
    return memory.withLock { $0.cache.value(forKey: key) }.flatMap(Self.remembered)
  }

  /// From this client's memory: no request goes out, so it is not a fresh model answer.
  private static func remembered(_ hit: SemanticResponse) -> SemanticResponse? {
    if hit.overLimit { return nil }
    var remembered = hit
    remembered.cached = true
    return remembered
  }

  /// The request URL, which is also the key of the memory. `nil`: nothing to ask (an empty query,
  /// or a pause after an over-limit answer). The client fuses with its own alias results, so it
  /// asks for semantic results only. The session applies the culture layer on the device after
  /// fusion, so the API must not (`culture=0`). Only the region "auto" is sent.
  private nonisolated func requestURL(query: String, options: SemanticSearchOptions) throws -> URL? {
    if Normalizer.normalize(query).isEmpty || now() < memory.withLock({ $0.pausedUntil }) {
      return nil
    }
    // The text the API embeds, accents and punctuation kept (`normalize` would fold them).
    var parameters = [
      ("q", Normalizer.embeddingText(query)), ("locale", options.locale ?? "en"),
      ("limit", String(options.limit)), ("mode", "semantic"), ("culture", "0"),
    ]
    if isAutoRegion(options.region) { parameters.append(("region", autoRegion)) }
    if let packVersion = configuration.packVersion { parameters.append(("pack", packVersion)) }
    if let key = configuration.key { parameters.append(("key", key)) }
    let base = URLEncoding.trimmingTrailingSlashes(configuration.endpoint)
    return try URLEncoding.url("\(base)/v1/search?\(URLEncoding.formEncoded(parameters))")
  }
}
